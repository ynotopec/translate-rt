import argparse
import os

import requests
from flask import Flask, jsonify, render_template, request


def _join_url(base_url, path):
    return f'{base_url.rstrip("/")}/{path.lstrip("/")}'


def _frontend_api_base():
    explicit_base = os.environ.get('TRANSLATE_RT_API_BASE', '').strip()
    if explicit_base:
        return explicit_base

    scheme = os.environ.get('TRANSLATE_RT_API_SCHEME', 'https').strip()
    host = os.environ.get('TRANSLATE_RT_API_HOST', 'api-translate-rt.ailab.infocepo.com').strip()
    return f'{scheme}://{host}'


app = Flask(__name__, template_folder='static/html', static_url_path='/static')
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_REQUEST_BYTES', str(12 * 1024 * 1024)))


@app.post('/api/<operation>')
def proxy_api(operation):
    paths = {'upload': '/upload', 'tts-proxy': '/tts-proxy', 'translate-text': '/translate-text'}
    if operation not in paths:
        return jsonify(detail='Route inconnue'), 404
    # A custom header forces cross-origin browsers through a preflight, which
    # this same-origin frontend does not authorize. Do not enable Flask CORS.
    if request.headers.get('X-Translate-RT') != '1':
        return jsonify(detail='En-tête de requête manquant'), 403
    origin = request.headers.get('Origin')
    if origin and origin.rstrip('/') != os.getenv('FRONTEND_PUBLIC_ORIGIN', request.host_url).rstrip('/'):
        return jsonify(detail='Origine non autorisée'), 403
    headers = {'Content-Type': request.content_type or 'application/octet-stream'}
    token = os.getenv('TRANSLATE_RT_API_TOKEN', '').strip()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    override = {'upload': 'TRANSLATE_RT_UPLOAD_URL', 'tts-proxy': 'TRANSLATE_RT_TTS_URL'}
    url = os.getenv(override.get(operation, ''), '') or _join_url(_frontend_api_base(), paths[operation])
    try:
        response = requests.post(url, data=request.get_data(), headers=headers, timeout=(5, float(os.getenv('PROXY_READ_TIMEOUT', '120'))))
    except requests.Timeout:
        return jsonify(detail='Délai du service dépassé'), 504
    except requests.RequestException:
        return jsonify(detail='Service indisponible'), 502
    return response.content, response.status_code, {'Content-Type': response.headers.get('Content-Type', 'application/json')}



@app.route('/')
def index():
    return render_template(
        'index.html',
        translate_rt_config={
            'UPLOAD_URL': '/api/upload',
            'TTS_URL': '/api/tts-proxy',
        },
    )

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Serve the translate-rt frontend.')
    parser.add_argument('--host', default=os.environ.get('SERVER_NAME', 'localhost'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('SERVER_PORT', 5000)))
    args = parser.parse_args()

    app.run(debug=False, host=args.host, port=args.port)
