from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)  # This will enable CORS for all routes

OPENAI_API_KEY = 'EMPTY'

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
    if 'text' in response_data:
        text = response_data['text']
        #if text == specific_sentence:
        prompt_value = text
        #modified_text = f"{text} toto."
        #response_data['text'] = modified_text

    # Setting environment variables (can also be set outside of this function if preferred)
    os.environ['OPENAI_API_MODEL'] = "qwen2.5"
    os.environ['OPENAI_API_BASE'] = "https://api-ai.numerique-interieur.com/v1"
    os.environ['OPENAI_API_KEY'] = "sk-<REDACTED>"

    data = {
        "model": os.getenv('OPENAI_API_MODEL'),
        "messages": [{"role": "user", "content": 'Translate in french without interpreting or explaining, if words comming :\n\n' + prompt_value}],
        "temperature": 0.1
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
        #return response.json()['choices'][0]['message']['content']
        modified_text = response.json()['choices'][0]['message']['content']
        response_data['text'] = modified_text
        return response_data

    else:
        raise Exception(f"Request failed with status code {response.status_code}")


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    try:
        files = {
            'file': (file.filename, file.stream, 'audio/ogg'),
            'model': (None, 'whisper-1')
        }

        headers = {
            'Authorization': f'Bearer {OPENAI_API_KEY}',
        }

        response = requests.post(
            'https://api-audio2txt.c0.cloud-pi-native.com/v1/audio/transcriptions',
            headers=headers,
            files=files
        )

        response.raise_for_status()
        
        # Getting the JSON response and then modifying it before returning to the client
        json_data = response.json()
        
        # Pretty-print the original JSON data for debugging purposes
        print(json_data)
        
        modified_response = modify_response(json_data)
        
        return jsonify(modified_response)
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('SERVER_PORT', 5001))  # Utilise l'argument d'environnement 'PORT' s'il est défini, sinon utilise 5001 par défaut.
    host = os.environ.get('SERVER_NAME', 'localhost')
    app.run(debug=True, host=host, port=port)
