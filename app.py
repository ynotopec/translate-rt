import argparse
import os

from flask import Flask, render_template

app = Flask(__name__, template_folder='static/html', static_url_path='/static')

@app.route('/')
def index():
    return render_template('index.html')  # Remplacez 'yourfile' par le nom de votre fichier HTML

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Serve the translate-rt frontend.')
    parser.add_argument('--host', default=os.environ.get('SERVER_NAME', 'localhost'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('SERVER_PORT', 5000)))
    args = parser.parse_args()

    app.run(debug=False, host=args.host, port=args.port)
