# /home/ailab/api-translate-rt/app.py
import os, json, re, logging
from functools import lru_cache
from typing import Dict, Any
from io import BytesIO

import requests
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

# ────────────────────────────── Config & logging ──────────────────────────────
log = logging.getLogger(__name__).info
logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(asctime)s – %(message)s')

def _summarize_payload(payload: Any, *, limit: int = 200) -> str:
    try:
        if payload is None: return 'None'
        if isinstance(payload, (str, bytes)):
            if isinstance(payload, bytes): payload = payload.decode('utf-8', errors='replace')
            return payload if len(payload) <= limit else payload[:limit] + '…'
        if isinstance(payload, (int, float, bool)): return repr(payload)
        if isinstance(payload, dict):
            j = json.dumps(payload, default=str)
            return j if len(j) <= limit else j[:limit] + '…'
        if isinstance(payload, (list, tuple, set)):
            j = json.dumps(list(payload), default=str)
            return j if len(j) <= limit else j[:limit] + '…'
        return repr(payload)[:limit] + ('…' if len(repr(payload)) > limit else '')
    except Exception as exc:
        return f'<unserializable payload: {exc}>'

class Cfg:
    AUDIO_API_KEY   = os.getenv('AUDIO_API_KEY')
    OPENAI_API_KEY  = os.getenv('OPENAI_API_KEY')
    OPENAI_API_BASE = os.getenv('OPENAI_API_BASE', '')
    OPENAI_MODEL    = os.getenv('OPENAI_API_MODEL', 'gpt-oss')
    WHISPER_URL     = os.getenv('WHISPER_URL', 'https://api-audio2txt.cloud-pi-native.com/v1/audio/transcriptions')
    DIAR_URL        = os.getenv('DIAR_URL', 'https://api-diarization.cloud-pi-native.com/upload-audio/')
    DIAR_TOKEN      = os.getenv('DIARIZATION_TOKEN')
    TTS_API_KEY     = os.getenv('TTS_API_KEY')
    TTS_URL         = os.getenv('TTS_API_URL', 'https://api-txt2audio.cloud-pi-native.com/v1/audio/speech')
    REQUEST_TIMEOUT = int(os.getenv('REQUEST_TIMEOUT', '30'))
    MAX_CACHE_SIZE  = int(os.getenv('MAX_CACHE_SIZE', '256'))

for v in ('AUDIO_API_KEY', 'OPENAI_API_KEY'):
    if not getattr(Cfg, v):
        raise RuntimeError(f'Missing mandatory env variable : {v}')

session = requests.Session()
session.mount('http://', requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=2))
session.mount('https://', requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=2))

def post(url: str, **kw) -> requests.Response:
    kw.setdefault('timeout', Cfg.REQUEST_TIMEOUT)
    payload_preview = {}
    for key in ('json', 'data'):
        if key in kw and kw[key] is not None:
            payload_preview[key] = _summarize_payload(kw[key])
    if 'files' in kw:
        payload_preview['files'] = list(kw['files'].keys())
    log(f"[IO][HTTP][OUTBOUND] POST {url} opts={{'timeout': {kw.get('timeout')}}} payload={payload_preview}")
    r = session.post(url, **kw)
    log(f"[IO][HTTP][OUTBOUND][RESPONSE] url={url} status={r.status_code} length={len(r.content)}")
    r.raise_for_status()
    return r

# ────────────────────────────── Helpers ──────────────────────────────
FILTER = {s.lower() for s in ('thank you.',)}
LANG_NAME = {'fr':'French','en':'English','ro':'Romanian','bg':'Bulgarian','es':'Spanish','de':'German','it':'Italian','pt':'Brazilian Portuguese','ru':'Russian','zh-cn':'Simplified Chinese','zh-tw':'Traditional Chinese'}

def tiny_chunk(data: bytes) -> bool:
    return len(data) < 16_000


def call_whisper(filename: str, data: bytes) -> Dict[str, Any]:
    files = {'file': (filename, BytesIO(data), 'audio/webm'), 'model': (None, 'whisper-1')}
    return post(Cfg.WHISPER_URL, headers={'Authorization': f'Bearer {Cfg.AUDIO_API_KEY}'}, files=files).json()


def call_diarization(filename: str, data: bytes, target_lang: str) -> Dict[str, Any]:
    if not Cfg.DIAR_TOKEN: return {}
    files = {'file': (filename, BytesIO(data), 'audio/webm'), 'target_lang': (None, target_lang)}
    try:
        return post(Cfg.DIAR_URL, headers={'Authorization': f'Bearer {Cfg.DIAR_TOKEN}'}, files=files).json()
    except Exception as e:
        log(f'[DIARIZATION ERROR] {e}')
        return {}


def _looks_like_noise(text: str, whisper_payload: Dict[str, Any]) -> bool:
    """Heuristic to detect transcripts produced from silence or background noise."""

    def _is_short_phrase(value: str) -> bool:
        words = value.split()
        return len(value) <= 3 or (len(value) <= 7 and len(words) <= 2)

    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return True

    # Punctuation-only snippets ("." or "…") are almost always silence artefacts.
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
def translate_text(text: str, lang: str) -> str:
    lang_prompt = LANG_NAME.get(lang, lang)
    data = {
        'model': Cfg.OPENAI_MODEL,
        'messages': [
            {'role':'system','content':'You are a professional translator. Translate accurately and naturally.'},
            {'role':'user','content':f'Translate the text into {lang_prompt}. Return ONLY the translation.\n\n{text}'}
        ],
        'temperature': 0
    }
    out = post(f"{Cfg.OPENAI_API_BASE}/chat/completions", headers={'Authorization': f'Bearer {Cfg.OPENAI_API_KEY}'}, json=data).json()['choices'][0]['message']['content']
    return re.sub(r'\s+', ' ', out).strip()

def build_translations(txt: str, detected: str, primary: str, target: str) -> Dict[str, str]:
    out = {}
    for lg in {primary, target} - {detected}:
        try:
            out[f'translation_{lg}'] = translate_text(txt, lg)
        except Exception as e:
            log(f'[TRANSLATION ERROR target={lg}] {e}')
            out[f'translation_{lg}'] = txt
    return out


class TextTranslationRequest(BaseModel):
    text: str = Field(..., description='Text to translate')
    target_lang: str = Field('fr', description='BCP-47 code of the desired translation language')


class TextTranslationResponse(BaseModel):
    translation: str = Field(..., description='Translated text')

# ────────────────────────────── FastAPI app ──────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post('/tts-proxy')
def tts_proxy(payload: Dict[str, Any] = Body(...)):
    r = post(Cfg.TTS_URL, headers={'Authorization': f'Bearer {Cfg.TTS_API_KEY}','Content-Type':'application/json'}, json=payload)
    return Response(content=r.content, status_code=r.status_code, media_type=r.headers.get('Content-Type','audio/webm'))


@app.post('/translate-text', response_model=TextTranslationResponse)
def translate_text_endpoint(payload: TextTranslationRequest):
    text = (payload.text or '').strip()
    if not text:
        raise HTTPException(status_code=400, detail='Text must not be empty')

    try:
        translation = translate_text(text, payload.target_lang)
    except Exception as exc:
        log(f'[TRANSLATE TEXT ERROR] {exc}')
        raise HTTPException(status_code=502, detail='Translation provider error') from exc

    return TextTranslationResponse(translation=translation)


@app.post('/upload')
async def upload(
    file: UploadFile = File(...),
    target_lang: str = Form('fr'),
    primary_lang: str = Form('fr'),
):
    if not file:
        raise HTTPException(status_code=400, detail='No file provided')

    contents = await file.read()

    if tiny_chunk(contents):
        await file.close()
        return {'text': ''}

    diar = call_diarization(file.filename, contents, target_lang)
    whisper_payload = {}
    try:
        whisper_payload = call_whisper(file.filename, contents) or {}
        text = whisper_payload.get('text', '').strip()
    except Exception as e:
        log(f'[WHISPER ERROR] {e}')
        text = ''

    if text and _looks_like_noise(text, whisper_payload):
        log(f"[WHISPER] filtered probable noise transcript: {text!r}")
        text = ''

    if not text or text.lower() in FILTER:
        await file.close()
        return {'text': '', 'diarization': diar}

    try:
        from langdetect import detect

        detected = detect(text)
    except Exception:
        detected = ''

    res = {'detected_lang': detected, 'transcription': text, 'diarization': diar}
    res.update(build_translations(text, detected, primary_lang, target_lang))

    await file.close()
    return res


# ────────────────────────────── Entrypoint ──────────────────────────────
if __name__ == '__main__':
    import uvicorn

    port = int(os.getenv('SERVER_PORT', 8080))
    host = os.getenv('SERVER_NAME', '0.0.0.0')
    log(f"[BOOT] FastAPI server listening on {host}:{port}")
    uvicorn.run('app:app', host=host, port=port, log_level='info')
