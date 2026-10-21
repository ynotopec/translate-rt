# /home/ailab/api-translate-rt/app.py
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import requests
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from guards import RequestGuards

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


def _env_timeout(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default

    try:
        timeout = float(value)
    except ValueError as exc:
        raise RuntimeError(f'{name} must be a number') from exc

    if timeout <= 0:
        raise RuntimeError(f'{name} must be greater than zero')
    return timeout


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

    CONNECT_TIMEOUT = _env_timeout('CONNECT_TIMEOUT', 5)
    REQUEST_TIMEOUT = _env_timeout('REQUEST_TIMEOUT', 30)
    OPENAI_REQUEST_TIMEOUT = _env_timeout('OPENAI_REQUEST_TIMEOUT', 60)

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

# Independent upstream round-trips are fanned out on this pool so they overlap
# instead of adding up on the request's critical path. Keep it comfortably
# larger than the per-request fan-out (2 for STT/diarization, 2 for targets).
IO_POOL_WORKERS = int(os.getenv('IO_POOL_WORKERS', '16'))
io_pool = ThreadPoolExecutor(max_workers=IO_POOL_WORKERS, thread_name_prefix='upstream-io')


def post(url: str, **kwargs: Any) -> requests.Response:
    # A tuple keeps a slow provider response from inheriting the much shorter
    # connection-establishment limit.
    kwargs.setdefault('timeout', (Cfg.CONNECT_TIMEOUT, Cfg.REQUEST_TIMEOUT))

    logger.info('[HTTP OUTBOUND] provider=%s', urlsplit(url).hostname)

    try:
        response = session.post(url, **kwargs)
        logger.info(
            "[IO][HTTP][OUTBOUND][RESPONSE] url=%s status=%s length=%s",
            url,
            response.status_code,
            len(response.content),
        )
        return response
    except requests.Timeout as exc:
        logger.warning('Upstream request timed out for %s: %s', url, exc)
        raise HTTPException(status_code=504, detail='Upstream request timed out') from exc
    except requests.RequestException as exc:
        logger.exception('HTTP request failed for %s', url)
        raise HTTPException(status_code=502, detail='Upstream request failed') from exc


def raise_for_upstream(response: requests.Response, provider_name: str) -> None:
    if response.ok:
        return

    logger.error(
        '[%s ERROR] status=%s detail=%s',
        provider_name,
        response.status_code,
        'redacted',
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


def translate_text_cached(text: str, lang: str) -> str:
    """Legacy helper name; deliberately no shared cache of conversation content."""
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
        timeout=(Cfg.CONNECT_TIMEOUT, Cfg.OPENAI_REQUEST_TIMEOUT),
    )
    raise_for_upstream(response, 'Translation')

    data = _safe_json(response)
    try:
        content = data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        logger.error('Unexpected translation response format')
        raise HTTPException(status_code=502, detail='Invalid translation response format') from exc

    return _normalize_text(content)


def build_translations(text: str, detected_lang: str, primary_lang: str, target_lang: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    detected_lang = _sanitize_lang(detected_lang, '')
    primary_lang = _sanitize_lang(primary_lang)
    target_lang = _sanitize_lang(target_lang)

    # `dict.fromkeys` de-duplicates while keeping a deterministic order, so both
    # targets are requested concurrently instead of one after the other.
    targets = [
        lang
        for lang in dict.fromkeys((primary_lang, target_lang))
        if lang and lang != detected_lang
    ]

    if not targets:
        return result

    futures = {lang: io_pool.submit(translate_text_cached, text, lang) for lang in targets}

    first_error: Optional[HTTPException] = None
    for lang, future in futures.items():
        try:
            result[f'translation_{lang}'] = future.result()
        except HTTPException as exc:
            if first_error is None:
                first_error = exc
        except Exception:
            logger.error('[TRANSLATION ERROR target=%s]', lang)
            if first_error is None:
                first_error = HTTPException(status_code=502, detail='Réponse du service de traduction invalide')

    if first_error is not None:
        raise first_error

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


def process_audio_chunk(
    filename: str,
    content_type: str,
    data: bytes,
    primary_lang: str,
    target_lang: str,
) -> Dict[str, Any]:
    """Run the audio pipeline while overlapping independent provider calls.

    Translation can begin as soon as Whisper returns because it does not need
    diarization.  The critical path is consequently close to
    ``max(diarization, transcription + translation)`` instead of the sum of
    diarization and translation.
    """
    diarization_future = io_pool.submit(call_diarization, filename, content_type, data, target_lang)

    try:
        # The synchronous route already runs in a Starlette worker thread, so
        # submitting Whisper to another pool only adds scheduling overhead.
        whisper_payload = call_whisper(filename, content_type, data) or {}
    except Exception:
        # Do not leave work associated with a failed request running.
        diarization_future.result()
        raise

    transcription = _normalize_text(whisper_payload.get('text', ''))
    if transcription and _looks_like_noise(transcription, whisper_payload):
        logger.info('[WHISPER] filtered probable noise transcript')
        transcription = ''

    detected_lang = ''
    translations: Dict[str, str] = {}
    try:
        if transcription and transcription.lower() not in FILTER_NORMALIZED:
            detected_lang = detect_language(transcription)
            translations = build_translations(
                transcription,
                detected_lang,
                primary_lang,
                target_lang,
            )
    finally:
        # Always settle the future before returning or propagating an error.
        diarization = diarization_future.result()

    if not transcription or transcription.lower() in FILTER_NORMALIZED:
        transcription = ''
        detected_lang = ''

    return {
        'transcription': transcription,
        'detected_lang': detected_lang,
        'diarization': diarization,
        **translations,
    }


def detect_language(text: str) -> str:
    try:
        from langdetect import detect
        return _sanitize_lang(detect(text), '')
    except Exception:
        return ''


# ────────────────────────────── API models ──────────────────────────────
class TextTranslationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000, description='Text to translate')
    target_lang: str = Field('fr', max_length=35, pattern=r'^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$', description='BCP-47 language')


class TextTranslationResponse(BaseModel):
    translation: str = Field(..., description='Translated text')


class UploadResponse(BaseModel):
    transcription: str = Field('', description='Transcribed text')
    detected_lang: str = Field('', description='Detected language')
    diarization: Dict[str, Any] = Field(default_factory=dict, description='Diarization payload')



# ────────────────────────────── FastAPI app ──────────────────────────────
app = FastAPI()
# Register guards before CORS so preflight responses are handled outside auth.
app.add_middleware(RequestGuards, token=Cfg.TRANSLATE_RT_API_TOKEN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_origin_regex=ALLOW_ORIGIN_REGEX,
    allow_credentials=Cfg.CORS_ALLOW_CREDENTIALS,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/healthz')
def healthz() -> Dict[str, str]:
    return {'status': 'ok'}


@app.post('/tts-proxy')
def tts_proxy(payload: Dict[str, Any] = Body(...)) -> Response:
    if not Cfg.TTS_API_KEY:
        raise HTTPException(status_code=503, detail='TTS is not configured')

    if not isinstance(payload.get('input'), str) or not 0 < len(payload['input']) <= 20000:
        raise HTTPException(status_code=422, detail='Le texte TTS doit contenir entre 1 et 20000 caractères')

    response = post(
        Cfg.TTS_URL,
        headers={
            'Authorization': f'Bearer {Cfg.TTS_API_KEY}',
            'Content-Type': 'application/json',
        },
        json=payload,
    )

    if not response.ok:
        logger.error(
            '[TTS ERROR] status=%s detail=%s',
            response.status_code,
            'redacted',
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
        logger.error('[TRANSLATE TEXT ERROR]')
        raise HTTPException(status_code=502, detail='Translation provider error') from exc

    return TextTranslationResponse(translation=translation)


@app.post('/upload')
def upload(
    file: UploadFile = File(...),
    target_lang: str = Form('fr', max_length=35, pattern=r'^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
    primary_lang: str = Form('fr', max_length=35, pattern=r'^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
) -> Dict[str, Any]:
    if not file:
        raise HTTPException(status_code=400, detail='No file provided')

    target_lang = _sanitize_lang(target_lang)
    primary_lang = _sanitize_lang(primary_lang)

    filename = file.filename or 'audio.bin'
    content_type = _guess_content_type(file, filename)

    # This route is intentionally synchronous: Starlette offloads sync
    # handlers to a worker thread, so the blocking `requests` round-trips
    # below no longer stall the event loop (and every other request with it).
    try:
        contents = file.file.read(int(os.getenv('MAX_AUDIO_BYTES', str(10 * 1024 * 1024))) + 1)
    finally:
        file.file.close()

    if len(contents) > int(os.getenv('MAX_AUDIO_BYTES', str(10 * 1024 * 1024))):
        raise HTTPException(status_code=413, detail='Fichier audio trop volumineux')

    if not contents:
        raise HTTPException(status_code=400, detail='Uploaded file is empty')

    if _is_small_audio(contents):
        return {
            'transcription': '',
            'detected_lang': '',
            'diarization': {},
        }

    try:
        return process_audio_chunk(
            filename,
            content_type,
            contents,
            primary_lang,
            target_lang,
        )
    except HTTPException:
        raise
    except Exception:
        logger.error('[WHISPER] invalid upstream response')
        raise HTTPException(status_code=502, detail='Réponse du service audio invalide')


# ────────────────────────────── Entrypoint ──────────────────────────────
if __name__ == '__main__':
    import uvicorn

    port = int(os.getenv('SERVER_PORT', '8080'))
    host = os.getenv('SERVER_NAME', '0.0.0.0')

    logger.info('[BOOT] FastAPI server listening on %s:%s', host, port)
    uvicorn.run('app:app', host=host, port=port, log_level='info')
