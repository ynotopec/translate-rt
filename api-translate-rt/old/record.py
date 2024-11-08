import pyaudio
import opuslib
import numpy as np

# Paramètres de l'enregistrement
FORMAT = pyaudio.paInt16  # Format audio
CHANNELS = 1  # Mono
RATE = 48000  # Fréquence d'échantillonnage
CHUNK = 1024  # Taille du buffer
RECORD_SECONDS = 10  # Durée de l'enregistrement
OUTPUT_FILENAME = "output.opus"  # Nom du fichier de sortie

# Initialiser PyAudio
audio = pyaudio.PyAudio()

# Ouvrir le flux d'entrée
stream = audio.open(format=FORMAT,
                    channels=CHANNELS,
                    rate=RATE,
                    input=True,
                    frames_per_buffer=CHUNK)

print("Enregistrement en cours...")

frames = []

# Enregistrer les données audio
for _ in range(0, int(RATE / CHUNK * RECORD_SECONDS)):
    data = stream.read(CHUNK)
    frames.append(data)

print("Enregistrement terminé.")

# Arrêter et fermer le flux
stream.stop_stream()
stream.close()
audio.terminate()

# Encoder les données en Opus
encoder = opuslib.Encoder(RATE, CHANNELS, opuslib.APPLICATION_AUDIO)
encoded_frames = []

for frame in frames:
    # Convertir les données en format attendu par Opus
    pcm = np.frombuffer(frame, dtype=np.int16)
    encoded_frame = encoder.encode(pcm.tobytes(), CHUNK)
    encoded_frames.append(encoded_frame)

# Sauvegarder les données encodées dans un fichier Opus
with open(OUTPUT_FILENAME, 'wb') as opus_file:
    for encoded_frame in encoded_frames:
        opus_file.write(encoded_frame)

print(f"Enregistrement sauvegardé dans {OUTPUT_FILENAME}")
