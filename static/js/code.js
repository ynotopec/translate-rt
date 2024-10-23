const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const transcriptionResult = document.getElementById('transcriptionResult');

let mediaRecorder;
let audioChunks = [];
let recordingInterval;
let audioContext;
let analyser;
let dataArray;
let silenceThreshold = 0.01; // Adjust this threshold based on your environment
let silenceDuration = 1000; // 1 second
let silenceStart = 0;
let recordingStartTime = 0;
let minChunkDuration = 8000; // 8 seconds
let maxChunkDuration = 10000; // 10 seconds
let shouldRestartRecording = false;

recordButton.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArray = new Float32Array(analyser.fftSize);

        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
            const audioUrl = URL.createObjectURL(audioBlob);
            audioChunks = [];

            await sendAudioToServer(audioBlob);

            // Restart recording if required
            if (shouldRestartRecording) {
                shouldRestartRecording = false;
                mediaRecorder.start();
                recordingStartTime = Date.now();
            }
        };

        mediaRecorder.start();
        recordingStartTime = Date.now();
        monitorSilence();

        recordButton.disabled = true;
        stopButton.disabled = false;
    } catch (error) {
        console.error('Error accessing microphone:', error);
    }
});

stopButton.addEventListener('click', () => {
    clearInterval(recordingInterval);
    mediaRecorder.stop();
    audioContext.close(); // Close audio context to free resources
    recordButton.disabled = false;
    stopButton.disabled = true;
    shouldRestartRecording = false; // Prevent any auto-restart after manual stop
});

async function sendAudioToServer(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'file.opus');

    try {
        const response = await fetch('https://api-translate-rt.cloud-pi-native.com/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        displayTranscriptionResult(result);
    } catch (error) {
        console.error('Error sending audio to server:', error);
        transcriptionResult.textContent += 'Error: ' + error.message + '\n\n';
    }
}

function displayTranscriptionResult(result) {
    let text = result.text || ''; // Adjust this line based on the actual structure of your result
    text = text.replace(/[{}]/g, ''); // Remove curly braces

    const sentences = text.match(/[^.!?]*[.!?]/g);

    if (sentences) {
        sentences.forEach(sentence => {
            transcriptionResult.textContent += sentence.trim() + '\n';
        });
    } else {
        transcriptionResult.textContent += text.trim();
    }
}

function monitorSilence() {
    recordingInterval = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArray);
        let silence = true;
        for (let i = 0; i < dataArray.length; i++) {
            if (Math.abs(dataArray[i]) > silenceThreshold) {
                silence = false;
                silenceStart = 0;
                break;
            }
        }

        const currentTime = Date.now();

        if (silence) {
            if (silenceStart === 0) {
                silenceStart = currentTime;
            } else if (currentTime - silenceStart > silenceDuration && currentTime - recordingStartTime > minChunkDuration) {
                shouldRestartRecording = true;
                mediaRecorder.stop();
                silenceStart = 0;
            }
        }

        if (currentTime - recordingStartTime >= maxChunkDuration) {
            shouldRestartRecording = true;
            mediaRecorder.stop();
            recordingStartTime = currentTime;
            silenceStart = 0;
        }
    }, 100);
}
