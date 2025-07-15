import os
import logging
from functools import lru_cache
from typing import Dict, Any

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from langdetect import detect

# ──────────────────────────────
#  Configuration & journalisation
# ──────────────────────────────
class Config:
    AUDIO_API_KEY   = os.getenv('AUDIO_API_KEY')
    OPENAI_API_KEY  = os.getenv('OPENAI_API_KEY')
    OPENAI_API_BASE = os.getenv('OPENAI_API_BASE', '')
    OPENAI_MODEL    = os.getenv('OPENAI_API_MODEL', 'ai-chat')

    WHISPER_URL     = 'https://api-audio2txt.c0.cloud-pi-native.com/v1/audio/transcriptions'
    DIARIZATION_URL = 'https://api-diarization.cloud-pi-native.com/upload-audio/'
    DIARIZATION_TOKEN = os.getenv('DIARIZATION_TOKEN')

    TTS_API_KEY   = os.getenv('TTS_API_KEY')
    TTS_API_URL   = 'https://api-txt2audio.cloud-pi-native.com/v1/audio/speech'

    REQUEST_TIMEOUT = 30
    MAX_CACHE_SIZE  = 256

# Valide les clés critiques au démarrage
for var in ('AUDIO_API_KEY', 'OPENAI_API_KEY'):
    if not getattr(Config, var):
        raise RuntimeError(f'Missing mandatory env variable : {var}')

logging.basicConfig(level=logging.INFO,
                    format='[%(levelname)s] %(asctime)s – %(message)s')
log = logging.getLogger(__name__).info

# Session HTTP avec pool & retries
session = requests.Session()
adapter = requests.adapters.HTTPAdapter(
    pool_connections=20,
    pool_maxsize=20,
    max_retries=2
)
session.mount('http://', adapter)
session.mount('https://', adapter)

# ──────────────────────────────
#  Constantes
# ──────────────────────────────
FILTER = {s.lower() for s in ('thank you.',)}

LANG_NAME = {
    'af': 'Afrikaans', 'am': 'Amharic', 'ar': 'Arabic', 'az': 'Azerbaijani',
    'be': 'Belarusian', 'bg': 'Bulgarian', 'bn': 'Bengali', 'bs': 'Bosnian',
    'ca': 'Catalan', 'ceb': 'Cebuano', 'cs': 'Czech', 'cy': 'Welsh',
    'da': 'Danish', 'de': 'German', 'el': 'Greek', 'en': 'English',
    'en-gb': 'British English', 'eo': 'Esperanto', 'es': 'Spanish', 'et': 'Estonian',
    'fa': 'Persian', 'fi': 'Finnish', 'fr': 'French', 'ga': 'Irish',
    'gl': 'Galician', 'gu': 'Gujarati', 'ha': 'Hausa', 'haw': 'Hawaiian',
    'he': 'Hebrew', 'hi': 'Hindi', 'hmn': 'Hmong', 'hr': 'Croatian',
    'ht': 'Haitian Creole', 'hu': 'Hungarian', 'hy': 'Armenian', 'id': 'Indonesian',
    'ig': 'Igbo', 'is': 'Icelandic', 'it': 'Italian', 'ja': 'Japanese',
    'jv': 'Javanese', 'ka': 'Georgian', 'kk': 'Kazakh', 'km': 'Khmer',
    'kn': 'Kannada', 'ko': 'Korean', 'ku': 'Kurdish', 'ky': 'Kyrgyz',
    'la': 'Latin', 'lb': 'Luxembourgish', 'lo': 'Lao', 'lt': 'Lithuanian',
    'lv': 'Latvian', 'mg': 'Malagasy', 'mi': 'Maori', 'mk': 'Macedonian',
    'ml': 'Malayalam', 'mn': 'Mongolian', 'mr': 'Marathi', 'ms': 'Malay',
    'mt': 'Maltese', 'my': 'Burmese', 'ne': 'Nepali', 'nl': 'Dutch',
    'no': 'Norwegian', 'ny': 'Chichewa', 'pa': 'Punjabi', 'pl': 'Polish',
    'ps': 'Pashto', 'pt': 'Brazilian Portuguese', 'ro': 'Romanian', 'ru': 'Russian',
    'rw': 'Kinyarwanda', 'sd': 'Sindhi', 'si': 'Sinhala', 'sk': 'Slovak',
    'sl': 'Slovenian', 'sm': 'Samoan', 'sn': 'Shona', 'so': 'Somali',
    'sq': 'Albanian', 'sr': 'Serbian', 'st': 'Sesotho', 'su': 'Sundanese',
    'sv': 'Swedish', 'sw': 'Swahili', 'ta': 'Tamil', 'te': 'Telugu',
    'tg': 'Tajik', 'th': 'Thai', 'tr': 'Turkish', 'uk': 'Ukrainian',
    'ur': 'Urdu', 'uz': 'Uzbek', 'vi': 'Vietnamese', 'xh': 'Xhosa',
    'yi': 'Yiddish', 'yo': 'Yoruba', 'zh-cn': 'Simplified Chinese',
    'zh-tw': 'Traditional Chinese', 'zu': 'Zulu'
}

# ──────────────────────────────
#  Utilitaires
# ──────────────────────────────
def post(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault('timeout', Config.REQUEST_TIMEOUT)
    resp = session.post(url, **kwargs)
    resp.raise_for_status()
    return resp

def tiny_chunk(file) -> bool:
    # On se sert de content_length si disponible (plus rapide)
    if getattr(file, 'content_length', None):
        return file.content_length < 16_000
    pos = file.stream.tell()
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(pos)
    return size < 16_000

def call_whisper(file) -> Dict[str, Any]:
    files = {
#        'file': (file.filename, file.stream, 'audio/ogg'),
        'file': (file.filename, file.stream, 'audio/webm'),
        'model': (None, 'whisper-1')
    }
    headers = {'Authorization': f'Bearer {Config.AUDIO_API_KEY}'}
    return post(Config.WHISPER_URL, headers=headers, files=files).json()

def call_diarization(file, target_lang: str) -> Dict[str, Any]:
    file.stream.seek(0)
    files = {
#        'file': (file.filename, file.stream, 'audio/ogg'),
        'file': (file.filename, file.stream, 'audio/webm'),
        'target_lang': (None, target_lang)
    }
    headers = {'Authorization': f'Bearer {Config.DIARIZATION_TOKEN}'}
    try:
        return post(Config.DIARIZATION_URL, headers=headers, files=files).json()
    except Exception as e:
        log(f'[DIARIZATION ERROR] {e}')
        return {}

@lru_cache(maxsize=Config.MAX_CACHE_SIZE)
def translate_text(text: str, lang: str) -> str:
    lang_prompt = LANG_NAME.get(lang, lang)
    prompt = (
        f'You are a professional translator. Translate the following text '
        f'accurately and naturally into {lang_prompt}.\nText:\n{text}\n\n'
        'Only return the translated text.'
    )
    data = {
        'model': Config.OPENAI_MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.2
    }
    headers = {'Authorization': f'Bearer {Config.OPENAI_API_KEY}'}
    resp = post(f'{Config.OPENAI_API_BASE}/chat/completions',
                headers=headers, json=data)
    return resp.json()['choices'][0]['message']['content']

def build_translations(txt: str, detected: str,
                       primary: str, target: str) -> Dict[str, str]:
    """Retourne uniquement les traductions nécessaires."""
    translations = {}
    for lang in {primary, target} - {detected}:
        try:
            translations[f'translation_{lang}'] = translate_text(txt, lang)
        except Exception as e:
            log(f'[TRANSLATION ERROR target={lang}] {e}')
            translations[f'translation_{lang}'] = txt
    return translations

# ──────────────────────────────
#  Flask app
# ──────────────────────────────
app = Flask(__name__)
CORS(app)

@app.route('/tts-proxy', methods=['POST'])
def tts_proxy():
    if not Config.TTS_API_KEY:
        return jsonify({'error': 'TTS_API_KEY not configured'}), 500
    try:
        payload = request.get_json(force=True)
        headers = {
            'Authorization': f'Bearer {Config.TTS_API_KEY}',
            'Content-Type': 'application/json'
        }
        resp = post(Config.TTS_API_URL, headers=headers, json=payload)
        mime = resp.headers.get('Content-Type', 'audio/webm')
#opus')
        return resp.content, resp.status_code, {'Content-Type': mime}
    except Exception as e:
        log(f'[TTS PROXY ERROR] {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files.get('file')
    if not file or file.filename == '':
        return jsonify({'error': 'No file provided'}), 400
    if tiny_chunk(file):
        return jsonify({'text': ''})

    target_lang  = request.form.get('target_lang', 'fr')
    primary_lang = request.form.get('primary_lang', 'fr')

    diar = call_diarization(file, target_lang)

    # Réinitialise le pointeur avant Whisper
    file.stream.seek(0)
    try:
        whisper = call_whisper(file)
        text = whisper.get('text', '').strip()
    except Exception as e:
        log(f'[WHISPER ERROR] {e}')
        text = ''

    if not text or text.lower() in FILTER:
        return jsonify({'text': '', 'diarization': diar})

    try:
        detected = detect(text)
    except Exception:
        detected = ''

    result = {
        'detected_lang': detected,
        'transcription': text,
        'diarization': diar
    }
    result.update(build_translations(text, detected, primary_lang, target_lang))

    log(f'DEBUG detected={detected} target={target_lang} '
        f'primary={primary_lang} keys={list(result.keys())}')
    return jsonify(result)

if __name__ == '__main__':
    app.run(host=os.getenv('SERVER_NAME', '0.0.0.0'),
            port=int(os.getenv('SERVER_PORT', 5001)),
            debug=False)
