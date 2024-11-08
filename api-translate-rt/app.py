from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os

import sys

#debug
#import logging

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
        text = response_data['text'].lstrip()

#        print(text, file=sys.stderr)

#        texts_to_check = ["you", "Thank you.", "Tchau.", "Thank you.", ".", ""]
        texts_to_check = ["you", "Thank you.", "Tchau.", "Thank you.", ".", "Gracias.", "Obrigado.", "Hello.", "Продолжение следует...", "Спасибо."]

        for check_text in texts_to_check:
            if text == check_text:
                print(f"The text '{text}' matches one of the strings!")
                modified_text = ""
                break  # Exit the loop after a match is found

        # Check if the text is "you"
        #if text == " you":
        #    modified_text = ""  # Return an empty string if text is "you"
        else:
            prompt_value = text
            # Setting environment variables (can also be set outside of this function if preferred)
            os.environ['OPENAI_API_MODEL'] = "gemma2"
#-simpo"
#qwen2.5"
#-simpo"
            os.environ['OPENAI_API_BASE'] = "https://api-ai.numerique-interieur.com/v1"
            os.environ['OPENAI_API_KEY'] = "sk-<REDACTED>"

            data = {
                "model": os.getenv('OPENAI_API_MODEL'),
                "messages": [{"role": "system", "content": "You are a translator expert."},{"role": "user", "content": "GIVE ONLY RESULT. Translate in french this context:\n<context>" + prompt_value + "</context>"}],
#"Vous êtes un traducteur expert en français."},{"role": "user", "content": "Translate in french without comment, this:\n" + prompt_value}],
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
                modified_text = response.json()['choices'][0]['message']['content']
            else:
                raise Exception(f"Request failed with status code {response.status_code}")

        response_data['text'] = modified_text
    return response_data


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
        #print(json_data, file=sys.stderr)
        
        modified_response = modify_response(json_data)
        
        return jsonify(modified_response)
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500
#    except requests.exceptions.RequestException as e:
#        # Ajoutez des détails sur la requête et la réponse
#        logging.error(f"Request failed: {e}")
#        logging.error(f"Request URL: {response.url if response else 'Unknown URL'}")
#        logging.error(f"Response Status: {response.status_code if response else 'No response'}")
#        logging.error(f"Response Content: {response.content if response else 'No content'}")
#        return jsonify({'error': str(e), 'details': 'Server-side request failed'}), 500


if __name__ == '__main__':
    port = int(os.environ.get('SERVER_PORT', 5001))  # Utilise l'argument d'environnement 'PORT' s'il est défini, sinon utilise 5001 par défaut.
    host = os.environ.get('SERVER_NAME', 'localhost')
    app.run(debug=True, host=host, port=port)
