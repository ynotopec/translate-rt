import argparse
import os

from flask import Flask, render_template


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


@app.route('/')
def index():
    api_base = _frontend_api_base()
    return render_template(
        'index.html',
        translate_rt_config={
            'UPLOAD_URL': os.environ.get('TRANSLATE_RT_UPLOAD_URL') or _join_url(api_base, '/upload'),
            'TTS_URL': os.environ.get('TRANSLATE_RT_TTS_URL') or _join_url(api_base, '/tts-proxy'),
            'API_KEY': os.environ.get('TRANSLATE_RT_API_TOKEN', ''),
        },
    )

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Serve the translate-rt frontend.')
    parser.add_argument('--host', default=os.environ.get('SERVER_NAME', 'localhost'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('SERVER_PORT', 5000)))
    args = parser.parse_args()

    app.run(debug=False, host=args.host, port=args.port)
