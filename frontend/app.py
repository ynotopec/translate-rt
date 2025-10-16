from flask import Flask, render_template
import os

app = Flask(__name__, template_folder='static/html', static_url_path='/static')

@app.route('/')
def index():
    return render_template('index.html')  # Remplacez 'yourfile' par le nom de votre fichier HTML

if __name__ == '__main__':
    port = int(os.environ.get('SERVER_PORT', 5000))  # Utilise l'argument d'environnement 'PORT' s'il est défini, sinon utilise 5001 par défaut.
    host = os.environ.get('SERVER_NAME', 'localhost')
    app.run(debug=True, host=host,port=port)
