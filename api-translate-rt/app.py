from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

AUDIO2TXT_API_KEY = 'EMPTY'

# Define a function that modifies or processes the response
def modify_response(response_data):
    """
    Example modification: appending 'toto' to the text field in the response.
    
    Parameters:
        response_data (dict): The original data received from the transcription API
    
    Returns:
        dict: Modified dictionary with the updated text added into it.
    """
    # Extract the text from the response
    text = response_data.get('text', '').strip()
    
    # List of texts to ignore
    texts_to_check = ["you", "Thank you.", "Tchau.", "Gracias.", "Obrigado.", "Hello.", "Продолжение следует...", "Спасибо."]

    if text in texts_to_check:
        response_data['text'] = ""
        return response_data
    
    # Setting environment variables for OpenAI API
    os.environ['OPENAI_API_MODEL'] = "gemma2"
    os.environ['OPENAI_API_BASE'] = "https://api-ai.numerique-interieur.com/v1"
    os.environ['OPENAI_API_KEY'] = "sk-<REDACTED>"

    data = {
        "model": os.getenv('OPENAI_API_MODEL'),
        "messages": [
            {"role": "system", "content": "You are a translator expert."},
            {"role": "user", "content": f"GIVE ONLY RESULT. Translate in french this context:\n<context>{text}</context>"}
        ],
        "temperature": 0
    }

    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {os.getenv("OPENAI_API_KEY")}'
    }

    response = requests.post(
        url=f"{os.getenv('OPENAI_API_BASE')}/chat/completions",
        headers=headers,
        json=data
    )

    if response.status_code == 200:
        response_data['text'] = response.json()['choices'][0]['message']['content']
    else:
        response_data['text'] = ""

    return response_data


@app.route('/upload', methods=['POST'])
def upload_file():
    file = request.files.get('file')
    if not file or file.filename == '':
        return jsonify({'error': 'No file part or no selected file'}), 400

    try:
        files = {
            'file': (file.filename, file.stream, 'audio/ogg'),
            'model': (None, 'whisper-1')
        }

        headers = {
            'Authorization': f'Bearer {AUDIO2TXT_API_KEY}',
        }

        response = requests.post(
            'https://api-audio2txt.c0.cloud-pi-native.com/v1/audio/transcriptions',
            headers=headers,
            files=files
        )

        response.raise_for_status()
        json_data = response.json()
        modified_response = modify_response(json_data)

        return jsonify(modified_response)
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('SERVER_PORT', 5001))
    host = os.environ.get('SERVER_NAME', 'localhost')
    app.run(debug=True, host=host, port=port)
