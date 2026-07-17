# /home/ailab/api-translate-rt/app.py
import json
import logging
import os
import re
from functools import lru_cache
from io import BytesIO
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import requests
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# ────────────────────────────── Logging ──────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(asctime)s - %(name)s - %(message)s',
)
logger = logging.getLogger(__name__)

# ────────────────────────────── Helpers ──────────────────────────────
def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _summarize_payload(payload: Any, *, limit: int = 200) -> str:
    try:
        if payload is None:
            return 'None'
        if isinstance(payload, bytes):
            decoded = payload.decode('utf-8', errors='replace')
            return decoded if len(decoded) <= limit else decoded[:limit] + '…'
        if isinstance(payload, str):
            return payload if len(payload) <= limit else payload[:limit] + '…'
        if isinstance(payload, (int, float, bool)):
            return repr(payload)
        if isinstance(payload, dict):
            data = json.dumps(payload, default=str, ensure_ascii=False)
            return data if len(data) <= limit else data[:limit] + '…'
        if isinstance(payload, (list, tuple, set)):
            data = json.dumps(list(payload), default=str, ensure_ascii=False)
            return data if len(data) <= limit else data[:limit] + '…'
        data = repr(payload)
        return data if len(data) <= limit else data[:limit] + '…'
    except Exception as exc:
        return f'<unserializable payload: {exc}>'


def _sanitize_lang(value: Optional[str], default: str = 'fr') -> str:
    lang = (value or default).strip().lower()
    return lang or default


def _normalize_text(value: str) -> str:
    return re.sub(r'\s+', ' ', (value or '')).strip()


def _is_small_audio(data: bytes) -> bool:
    return len(data) < 16_000


def _guess_content_type(upload: UploadFile, filename: str) -> str:
    if upload.content_type:
        return upload.content_type
    lower = filename.lower()
    if lower.endswith('.webm'):
        return 'audio/webm'
    if lower.endswith('.ogg') or lower.endswith('.oga'):
        return 'audio/ogg'
    if lower.endswith('.wav'):
        return 'audio/wav'
    if lower.endswith('.mp3'):
        return 'audio/mpeg'
    if lower.endswith('.m4a'):
        return 'audio/mp4'
    if lower.endswith('.flac'):
        return 'audio/flac'
    return 'application/octet-stream'


def _safe_json(response: requests.Response) -> Dict[str, Any]:
    try:
        return response.json()
    except Exception as exc:
        logger.error('Invalid JSON response from upstream: %s', exc)
        raise HTTPException(status_code=502, detail='Invalid JSON response from upstream') from exc


# ────────────────────────────── Config ──────────────────────────────
class Cfg:
    AUDIO_API_KEY = os.getenv('AUDIO_API_KEY')
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
    OPENAI_API_BASE = os.getenv('OPENAI_API_BASE', '').rstrip('/')
    OPENAI_MODEL = os.getenv('OPENAI_API_MODEL', 'gpt-oss')

    AI_DEV_API_SCHEME = os.getenv('AI_DEV_API_SCHEME', 'https')
    AI_DEV_API_DOMAIN = os.getenv('AI_DEV_API_DOMAIN', 'ai-dev.numerique-interieur.com')

    WHISPER_URL = os.getenv(
        'WHISPER_URL',
        f'{AI_DEV_API_SCHEME}://api-audio2txt.{AI_DEV_API_DOMAIN}/v1/audio/transcriptions',
    )
    STT_MODEL = os.getenv('STT_MODEL', 'whisper-1')

    DIAR_URL = os.getenv(
        'DIAR_URL',
        f'{AI_DEV_API_SCHEME}://api-diarization.{AI_DEV_API_DOMAIN}/upload-audio/',
    )
    DIAR_TOKEN = os.getenv('DIARIZATION_TOKEN')

    TTS_API_KEY = os.getenv('TTS_API_KEY')
    TTS_URL = os.getenv(
        'TTS_API_URL',
        f'{AI_DEV_API_SCHEME}://api-txt2audio.{AI_DEV_API_DOMAIN}/v1/audio/speech',
    )

    REQUEST_TIMEOUT = int(os.getenv('REQUEST_TIMEOUT', '30'))
    MAX_CACHE_SIZE = int(os.getenv('MAX_CACHE_SIZE', '256'))

    CORS_ALLOW_CREDENTIALS = _env_bool('CORS_ALLOW_CREDENTIALS', False)
    CORS_ALLOW_ORIGINS = [
        origin.strip()
        for origin in os.getenv('CORS_ALLOW_ORIGINS', '*').split(',')
        if origin.strip()
    ]
    CORS_ALLOW_ORIGIN_REGEX = os.getenv('CORS_ALLOW_ORIGIN_REGEX', '').strip() or None
    TRANSLATE_RT_API_TOKEN = os.getenv('TRANSLATE_RT_API_TOKEN', '').strip()


def _build_origin_regex_from_origin(origin: str) -> Optional[str]:
    parsed = urlsplit(origin)
    if parsed.scheme not in {'http', 'https'}:
        return None

    host = parsed.hostname or ''
    if not host.startswith('.'):
        return None

    root_domain = re.escape(host[1:])
    port_pattern = rf':{parsed.port}' if parsed.port is not None else r'(?::\d+)?'
    return rf'^{parsed.scheme}://(?:[a-zA-Z0-9-]+\.)*{root_domain}{port_pattern}$'


def _resolve_cors_config() -> tuple[list[str], Optional[str]]:
    explicit_origins: list[str] = []
    regex_patterns: list[str] = []

    if Cfg.CORS_ALLOW_ORIGIN_REGEX:
        regex_patterns.append(Cfg.CORS_ALLOW_ORIGIN_REGEX)

    for origin in Cfg.CORS_ALLOW_ORIGINS:
        generated_regex = _build_origin_regex_from_origin(origin)
        if generated_regex:
            regex_patterns.append(generated_regex)
        else:
            explicit_origins.append(origin)

    allow_origin_regex = '|'.join(f'(?:{pattern})' for pattern in regex_patterns) or None
    return explicit_origins, allow_origin_regex


ALLOW_ORIGINS, ALLOW_ORIGIN_REGEX = _resolve_cors_config()


missing_env = []
if not Cfg.AUDIO_API_KEY:
    missing_env.append('AUDIO_API_KEY')
if not Cfg.OPENAI_API_KEY:
    missing_env.append('OPENAI_API_KEY')
if not Cfg.OPENAI_API_BASE:
    missing_env.append('OPENAI_API_BASE')

if missing_env:
    raise RuntimeError(f"Missing mandatory env variable(s): {', '.join(missing_env)}")

if Cfg.CORS_ALLOW_CREDENTIALS and ('*' in ALLOW_ORIGINS or ALLOW_ORIGIN_REGEX == '.*'):
    raise RuntimeError(
        'Invalid CORS configuration: CORS_ALLOW_CREDENTIALS=true cannot be used with CORS_ALLOW_ORIGINS=*'
    )

# ────────────────────────────── HTTP session ──────────────────────────────
session = requests.Session()
adapter = requests.adapters.HTTPAdapter(
    pool_connections=20,
    pool_maxsize=20,
    max_retries=2,
)
session.mount('http://', adapter)
session.mount('https://', adapter)


def post(url: str, **kwargs: Any) -> requests.Response:
    kwargs.setdefault('timeout', Cfg.REQUEST_TIMEOUT)

    payload_preview: Dict[str, Any] = {}
    for key in ('json', 'data'):
        if key in kwargs and kwargs[key] is not None:
            payload_preview[key] = _summarize_payload(kwargs[key])

    if 'files' in kwargs and kwargs['files'] is not None:
        payload_preview['files'] = list(kwargs['files'].keys())

    logger.info(
        "[IO][HTTP][OUTBOUND] POST %s opts=%s payload=%s",
        url,
        {'timeout': kwargs.get('timeout')},
        payload_preview,
    )

    try:
        response = session.post(url, **kwargs)
        logger.info(
            "[IO][HTTP][OUTBOUND][RESPONSE] url=%s status=%s length=%s",
            url,
            response.status_code,
            len(response.content),
        )
        return response
    except requests.RequestException as exc:
        logger.exception('HTTP request failed for %s', url)
        raise HTTPException(status_code=502, detail='Upstream request failed') from exc


def raise_for_upstream(response: requests.Response, provider_name: str) -> None:
    if response.ok:
        return

    detail = None
    try:
        payload = response.json()
        detail = payload.get('detail') if isinstance(payload, dict) else payload
    except Exception:
        detail = response.text[:500] if response.text else None

    logger.error(
        '[%s ERROR] status=%s detail=%s',
        provider_name,
        response.status_code,
        _summarize_payload(detail),
    )

    raise HTTPException(
        status_code=502,
        detail=f'{provider_name} provider error',
    )


# ────────────────────────────── Translation helpers ──────────────────────────────
FILTER_NORMALIZED = {
    _normalize_text(value).lower()
    for value in (
        'thank you.',
        'thank you',
    )
}

LANG_NAME = {
    'fr': 'French',
    'en': 'English',
    'ro': 'Romanian',
    'bg': 'Bulgarian',
    'es': 'Spanish',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'pt-br': 'Brazilian Portuguese',
    'pt-pt': 'European Portuguese',
    'ru': 'Russian',
    'zh-cn': 'Simplified Chinese',
    'zh-tw': 'Traditional Chinese',
}


def _looks_like_noise(text: str, whisper_payload: Dict[str, Any]) -> bool:
    def _is_short_phrase(value: str) -> bool:
        words = value.split()
        return len(value) <= 3 or (len(value) <= 7 and len(words) <= 2)

    cleaned = _normalize_text(text)
    if not cleaned:
        return True

    if not any(ch.isalnum() for ch in cleaned):
        return True

    payload = whisper_payload or {}
    segments = payload.get('segments') or []

    no_speech_scores = [
        seg.get('no_speech_prob')
        for seg in segments
        if isinstance(seg.get('no_speech_prob'), (int, float))
    ]
    top_no_speech = payload.get('no_speech_prob')
    if isinstance(top_no_speech, (int, float)):
        no_speech_scores.append(top_no_speech)

    avg_logprobs = [
        seg.get('avg_logprob')
        for seg in segments
        if isinstance(seg.get('avg_logprob'), (int, float))
    ]

    if no_speech_scores and max(no_speech_scores) >= 0.85 and _is_short_phrase(cleaned):
        return True

    if avg_logprobs:
        avg_lp = sum(avg_logprobs) / len(avg_logprobs)
        if avg_lp <= -1.25 and _is_short_phrase(cleaned):
            return True

    return False


@lru_cache(maxsize=Cfg.MAX_CACHE_SIZE)
def translate_text_cached(text: str, lang: str) -> str:
    lang = _sanitize_lang(lang)
    lang_prompt = LANG_NAME.get(lang, lang)

    payload = {
        'model': Cfg.OPENAI_MODEL,
        'messages': [
            {
                'role': 'system',
                'content': 'You are a professional translator. Translate accurately and naturally.',
            },
            {
                'role': 'user',
                'content': f'Translate the text into {lang_prompt}. Return ONLY the translation.\n\n{text}',
            },
        ],
        'temperature': 0,
    }

    response = post(
        f'{Cfg.OPENAI_API_BASE}/chat/completions',
        headers={
            'Authorization': f'Bearer {Cfg.OPENAI_API_KEY}',
            'Content-Type': 'application/json',
        },
        json=payload,
    )
    raise_for_upstream(response, 'Translation')

    data = _safe_json(response)
    try:
        content = data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        logger.error('Unexpected translation response format: %s', _summarize_payload(data))
        raise HTTPException(status_code=502, detail='Invalid translation response format') from exc

    return _normalize_text(content)


def build_translations(text: str, detected_lang: str, primary_lang: str, target_lang: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    detected_lang = _sanitize_lang(detected_lang, '')
    primary_lang = _sanitize_lang(primary_lang)
    target_lang = _sanitize_lang(target_lang)

    for lang in {primary_lang, target_lang}:
        if lang and lang != detected_lang:
            try:
                result[f'translation_{lang}'] = translate_text_cached(text, lang)
            except HTTPException:
                raise
            except Exception:
                logger.exception('[TRANSLATION ERROR target=%s]', lang)
                result[f'translation_{lang}'] = text

    return result


# ────────────────────────────── STT / diarization ──────────────────────────────
def call_whisper(filename: str, content_type: str, data: bytes) -> Dict[str, Any]:
    files = {
        'file': (filename, BytesIO(data), content_type),
        'model': (None, Cfg.STT_MODEL),
    }
    response = post(
        Cfg.WHISPER_URL,
        headers={'Authorization': f'Bearer {Cfg.AUDIO_API_KEY}'},
        files=files,
    )
    raise_for_upstream(response, 'Whisper')
    return _safe_json(response)


def call_diarization(filename: str, content_type: str, data: bytes, target_lang: str) -> Dict[str, Any]:
    if not Cfg.DIAR_TOKEN:
        return {}

    files = {
        'file': (filename, BytesIO(data), content_type),
        'target_lang': (None, target_lang),
    }

    try:
        response = post(
            Cfg.DIAR_URL,
            headers={'Authorization': f'Bearer {Cfg.DIAR_TOKEN}'},
            files=files,
        )
        raise_for_upstream(response, 'Diarization')
        return _safe_json(response)
    except HTTPException:
        logger.exception('[DIARIZATION ERROR]')
        return {}
    except Exception:
        logger.exception('[DIARIZATION ERROR]')
        return {}


def detect_language(text: str) -> str:
    try:
        from langdetect import detect
        return _sanitize_lang(detect(text), '')
    except Exception:
        return ''


# ────────────────────────────── API models ──────────────────────────────
class TextTranslationRequest(BaseModel):
    text: str = Field(..., description='Text to translate')
    target_lang: str = Field('fr', description='BCP-47 code of the desired translation language')


class TextTranslationResponse(BaseModel):
    translation: str = Field(..., description='Translated text')


class UploadResponse(BaseModel):
    transcription: str = Field('', description='Transcribed text')
    detected_lang: str = Field('', description='Detected language')
    diarization: Dict[str, Any] = Field(default_factory=dict, description='Diarization payload')



def require_api_token(request: Request) -> None:
    if not Cfg.TRANSLATE_RT_API_TOKEN:
        return

    expected = f'Bearer {Cfg.TRANSLATE_RT_API_TOKEN}'
    if request.headers.get('authorization') != expected:
        raise HTTPException(status_code=401, detail='Invalid or missing API token')

# ────────────────────────────── FastAPI app ──────────────────────────────
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_origin_regex=ALLOW_ORIGIN_REGEX,
    allow_credentials=Cfg.CORS_ALLOW_CREDENTIALS,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware('http')
async def api_token_middleware(request: Request, call_next):
    public_paths = {'/healthz', '/docs', '/redoc', '/openapi.json'}
    if Cfg.TRANSLATE_RT_API_TOKEN and request.url.path not in public_paths:
        require_api_token(request)
    return await call_next(request)


@app.get('/healthz')
def healthz() -> Dict[str, str]:
    return {'status': 'ok'}


@app.post('/tts-proxy')
def tts_proxy(payload: Dict[str, Any] = Body(...)) -> Response:
    if not Cfg.TTS_API_KEY:
        raise HTTPException(status_code=503, detail='TTS is not configured')

    response = post(
        Cfg.TTS_URL,
        headers={
            'Authorization': f'Bearer {Cfg.TTS_API_KEY}',
            'Content-Type': 'application/json',
        },
        json=payload,
    )

    if not response.ok:
        detail = None
        try:
            detail = response.json()
        except Exception:
            detail = response.text[:500] if response.text else None

        logger.error(
            '[TTS ERROR] status=%s detail=%s',
            response.status_code,
            _summarize_payload(detail),
        )

        return JSONResponse(
            status_code=502,
            content={'detail': 'TTS provider error'},
        )

    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=response.headers.get('Content-Type', 'audio/webm'),
    )


@app.post('/translate-text', response_model=TextTranslationResponse)
def translate_text_endpoint(payload: TextTranslationRequest) -> TextTranslationResponse:
    text = _normalize_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail='Text must not be empty')

    target_lang = _sanitize_lang(payload.target_lang)

    try:
        translation = translate_text_cached(text, target_lang)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('[TRANSLATE TEXT ERROR]')
        raise HTTPException(status_code=502, detail='Translation provider error') from exc

    return TextTranslationResponse(translation=translation)


@app.post('/upload')
async def upload(
    file: UploadFile = File(...),
    target_lang: str = Form('fr'),
    primary_lang: str = Form('fr'),
) -> Dict[str, Any]:
    if not file:
        raise HTTPException(status_code=400, detail='No file provided')

    target_lang = _sanitize_lang(target_lang)
    primary_lang = _sanitize_lang(primary_lang)

    filename = file.filename or 'audio.bin'
    content_type = _guess_content_type(file, filename)

    try:
        contents = await file.read()
    finally:
        await file.close()

    if not contents:
        raise HTTPException(status_code=400, detail='Uploaded file is empty')

    if _is_small_audio(contents):
        return {
            'transcription': '',
            'detected_lang': '',
            'diarization': {},
        }

    diarization = call_diarization(filename, content_type, contents, target_lang)

    whisper_payload: Dict[str, Any] = {}
    transcription = ''

    try:
        whisper_payload = call_whisper(filename, content_type, contents) or {}
        transcription = _normalize_text(whisper_payload.get('text', ''))
    except HTTPException:
        raise
    except Exception:
        logger.exception('[WHISPER ERROR]')
        transcription = ''

    if transcription and _looks_like_noise(transcription, whisper_payload):
        logger.info("[WHISPER] filtered probable noise transcript: %r", transcription)
        transcription = ''

    if not transcription or transcription.lower() in FILTER_NORMALIZED:
        return {
            'transcription': '',
            'detected_lang': '',
            'diarization': diarization,
        }

    detected_lang = detect_language(transcription)

    response: Dict[str, Any] = {
        'transcription': transcription,
        'detected_lang': detected_lang,
        'diarization': diarization,
    }

    response.update(build_translations(transcription, detected_lang, primary_lang, target_lang))
    return response


# ────────────────────────────── Entrypoint ──────────────────────────────
if __name__ == '__main__':
    import uvicorn

    port = int(os.getenv('SERVER_PORT', '8080'))
    host = os.getenv('SERVER_NAME', '0.0.0.0')

    logger.info('[BOOT] FastAPI server listening on %s:%s', host, port)
    uvicorn.run('app:app', host=host, port=port, log_level='info')
