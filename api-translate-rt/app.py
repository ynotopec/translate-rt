# /home/ailab/api-translate-rt/app.py
import os, json, tempfile, subprocess, re, logging
from functools import lru_cache
from typing import Dict, Any

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

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

def tiny_chunk(file) -> bool:
    if getattr(file, 'content_length', None):
        return file.content_length < 16_000
    p = file.stream.tell(); file.stream.seek(0, os.SEEK_END)
    s = file.stream.tell(); file.stream.seek(p)
    return s < 16_000

def call_whisper(file) -> Dict[str, Any]:
    files = {'file': (file.filename, file.stream, 'audio/webm'), 'model': (None, 'whisper-1')}
    return post(Cfg.WHISPER_URL, headers={'Authorization': f'Bearer {Cfg.AUDIO_API_KEY}'}, files=files).json()


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

def call_diarization(file, target_lang: str) -> Dict[str, Any]:
    if not Cfg.DIAR_TOKEN: return {}
    file.stream.seek(0)
    files = {'file': (file.filename, file.stream, 'audio/webm'), 'target_lang': (None, target_lang)}
    try:
        return post(Cfg.DIAR_URL, headers={'Authorization': f'Bearer {Cfg.DIAR_TOKEN}'}, files=files).json()
    except Exception as e:
        log(f'[DIARIZATION ERROR] {e}')
        return {}

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

def call_tts_webm(text: str, voice: str, instructions: str) -> bytes:
    payload = {
        'model':'gpt-4o-mini-tts',
        'input': text,
        'voice': voice,
        'instructions': instructions,
        'response_format':'opus'
    }
    return post(Cfg.TTS_URL, headers={'Authorization': f'Bearer {Cfg.TTS_API_KEY}','Content-Type':'application/json'}, json=payload).content

def call_tts_pcm16le(text: str, voice: str, instructions: str) -> bytes:
    webm = call_tts_webm(text, voice, instructions)
    with tempfile.NamedTemporaryFile(suffix='.webm') as fi, tempfile.NamedTemporaryFile(suffix='.pcm') as fo:
        fi.write(webm); fi.flush()
        subprocess.check_output(['ffmpeg','-y','-i',fi.name,'-f','s16le','-acodec','pcm_s16le','-ar','16000','-ac','1',fo.name], stderr=subprocess.DEVNULL)
        fo.seek(0)
        return fo.read()

# ────────────────────────────── Flask app ──────────────────────────────
app = Flask(__name__)
CORS(app)

@app.route('/tts-proxy', methods=['POST'])
def tts_proxy():
    payload = request.get_json(force=True)
    r = post(Cfg.TTS_URL, headers={'Authorization': f'Bearer {Cfg.TTS_API_KEY}','Content-Type':'application/json'}, json=payload)
    return r.content, r.status_code, {'Content-Type': r.headers.get('Content-Type','audio/webm')}

@app.route('/upload', methods=['POST'])
def upload():
    f = request.files.get('file')
    if not f: return jsonify({'error':'No file provided'}), 400
    if tiny_chunk(f): return jsonify({'text':''})
    target = request.form.get('target_lang','fr'); primary = request.form.get('primary_lang','fr')
    diar = call_diarization(f, target)
    f.stream.seek(0)
    whisper_payload = {}
    try:
        whisper_payload = call_whisper(f) or {}
        text = whisper_payload.get('text', '').strip()
    except Exception as e:
        log(f'[WHISPER ERROR] {e}')
        text = ''

    if text and _looks_like_noise(text, whisper_payload):
        log(f"[WHISPER] filtered probable noise transcript: {text!r}")
        text = ''

    if not text or text.lower() in FILTER:
        return jsonify({'text': '', 'diarization': diar})
    try: from langdetect import detect; detected = detect(text)
    except Exception: detected = ''
    res = {'detected_lang': detected, 'transcription': text, 'diarization': diar}
    res.update(build_translations(text, detected, primary, target))
    return jsonify(res)

# ────────────────────────────── Entrypoint ──────────────────────────────
if __name__ == '__main__':
    port = int(os.getenv('SERVER_PORT', 8080))
    host = os.getenv('SERVER_NAME', '0.0.0.0')
    log(f"[BOOT] Flask server listening on {host}:{port}")
    app.run(host=host, port=port, debug=False)
