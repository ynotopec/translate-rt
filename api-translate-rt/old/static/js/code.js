const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const audioPlayback = document.getElementById('audioPlayback');
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
let minChunkDuration = 4000; // 8 seconds
let maxChunkDuration = 6000; // 10 seconds

recordButton.addEventListener('click', async () => {
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
        audioPlayback.src = audioUrl;
        audioChunks = [];

        // Send the audio Blob to the server
        await sendAudioToServer(audioBlob);
    };

    // Start recording and monitor for silence
    mediaRecorder.start();
    recordingStartTime = Date.now();
    monitorSilence();

    recordButton.disabled = true;
    stopButton.disabled = false;
});

stopButton.addEventListener('click', () => {
    clearInterval(recordingInterval);
    mediaRecorder.stop();
    recordButton.disabled = false;
    stopButton.disabled = true;
});

async function sendAudioToServer(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'file.opus');

    try {
        const response = await fetch('http://back-translate-rt.c0.cloud-pi-native.com:8529/upload', {
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

    // Use a regex to identify complete sentences ending with . ! or ?
    const sentences = text.match(/[^.!?]*[.!?]/g);
    
    if (sentences) {
        sentences.forEach(sentence => {
            transcriptionResult.textContent += sentence.trim() + '\n';
        });
    } else {
        // If no complete sentences are found, just append the text as is
        transcriptionResult.textContent += text.trim() + '\n';
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
                mediaRecorder.stop();
                silenceStart = 0;
                mediaRecorder.start();
                recordingStartTime = currentTime;
            }
        }

        // Check if the recording has reached the maximum duration
        if (currentTime - recordingStartTime >= maxChunkDuration) {
            mediaRecorder.stop();
            mediaRecorder.start();
            recordingStartTime = currentTime;
            silenceStart = 0;
        }
    }, 100);
}
