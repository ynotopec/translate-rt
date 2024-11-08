import requests

# Replace 'EMPTY' with your actual API key
OPENAI_API_KEY = 'EMPTY'

url = 'https://api-audio2txt.c0.cloud-pi-native.com/v1/audio/transcriptions'
headers = {
    'Authorization': f'Bearer {OPENAI_API_KEY}',
    #'Content-Type': 'multipart/form-data'
}
files = {
    'file': ('file.opus', open('/media/noname/WORKDISK/AI-TOOLS/DATASET/file.opus', 'rb')),
    'model': (None, 'whisper-1')
}

response = requests.post(url, headers=headers, files=files)

print(response.json())
