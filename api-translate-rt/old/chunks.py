import os
import requests
import subprocess
from pydub import AudioSegment
from pydub.utils import make_chunks

import json

# Remplacez 'EMPTY' par votre clé API réelle
OPENAI_API_KEY = 'EMPTY'
API_URL = 'https://api-audio2txt.c0.cloud-pi-native.com/v1/audio/transcriptions'
SUMMARY_API_URL = 'https://api-summary.c0.cloud-pi-native.com/summary/'

# Chemin vers le fichier audio original
audio_file_path = '/media/noname/WORKDISK/ailab/.xes/20240710_221248.opus'
# Chemin vers le dossier pour stocker les segments audio
output_folder = '/home/ailab/api-audio2txt/chunks/'

# Créer le dossier de sortie s'il n'existe pas
os.makedirs(output_folder, exist_ok=True)

# Charger le fichier audio
audio = AudioSegment.from_file(audio_file_path)
#, format="opus")

# Découper le fichier en segments d'une minute (60000 ms)
chunk_length_ms = 90000  # 1 minute
chunks = make_chunks(audio, chunk_length_ms)

# Fonction pour envoyer un segment audio à l'API et obtenir la transcription
def transcribe_audio(file_path):
    with open(file_path, 'rb') as f:
        files = {
            'file': (os.path.basename(file_path), f),
            'model': (None, 'whisper-1')
        }
        headers = {
            'Authorization': f'Bearer {OPENAI_API_KEY}',
        }
        response = requests.post(API_URL, headers=headers, files=files)
        return response.json()

# Fonction pour envoyer le texte transcrit à l'API de résumé
def summarize_text(text):
    json_payload = f'{{"text": "{text}"}}'
    result = subprocess.run(
        ['curl', '-X', 'POST', SUMMARY_API_URL, '-H', 'Content-Type: application/json', '-d', json_payload],
        capture_output=True, text=True
    )
    return result.stdout

# Découper et traiter chaque segment
for i, chunk in enumerate(chunks):
    chunk_name = f"{output_folder}chunk{i}.opus"
    chunk.export(chunk_name, format="opus")
#    print(f"Processing chunk {i}...")

    # Transcrire le segment
    transcription_response = transcribe_audio(chunk_name)
    transcription_text = transcription_response.get('text', '')

    if transcription_text:
        # Résumer le texte transcrit
        summary = summarize_text(transcription_text)
        result = json.loads(summary)["result"]
        print(result)
#Summary for chunk {i}: {summary}")

print("Processing complete.")
