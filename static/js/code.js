// Elements HTML
const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const transcriptionResult = document.getElementById('transcriptionResult');
const langSelect = document.getElementById('langSelect');

// Globals
let mediaRecorder, audioChunks = [], recordingInterval;
let audioContext, analyser, dataArray, stream;
let voiceIndex = new Map(), voiceCounter = 1;
let ttsQueue = [], ttsInProgress = false;
const MAX_MESSAGES = 100;
let silenceThreshold = 0.04, silenceDuration = 800;
let silenceStart = 0, recordingStartTime = 0;
let minChunkDuration = 2000, maxChunkDuration = 8000, shouldRestartRecording = false;
let textBuffer = "", lastVoiceNumber = null, flushTimeout = null;
const MAX_BUFFER_LENGTH = 1000;

// UI colors & labels
const voiceColors = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c','#fabebe','#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000','#ffd8b1','#000075','#808080'];
//const speakerLabels = {fr:'Locuteur',en:'Speaker',bg:'Говорещ',de:'Sprecher',es:'Hablante',it:'Parlante',pt:'Falante'};
const speakerLabels = {
    'fr':    'Locuteur',
    'en':    'Speaker',
    'en-gb': 'Speaker',
    'es':    'Hablante',
    'it':    'Parlante',
    'pt':    'Falante',
    'hi':    'वक्ता',           // Vakta (Hindi)
    'ja':    '話者',            // Washa (Japonais)
    'zh-cn': '说话人',          // Shuōhuà rén (Chinois simplifié)
};

// Reset voice mapping
function resetVoiceIndexing() {
    voiceIndex.clear();
    voiceCounter = 1;
}

// Reuse and cleanup audio context/stream safely
async function initAudioStream() {
    if (audioContext) { try { await audioContext.close(); } catch {} audioContext = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    dataArray = new Float32Array(analyser.fftSize);
    audioContext.createMediaStreamSource(stream).connect(analyser);
}

// Start recording
recordButton.addEventListener('click', async () => {
    try {
        resetVoiceIndexing();
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext)
            return alert("Navigateur non compatible (MediaRecorder ou AudioContext absent).");
        await initAudioStream();
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = []; shouldRestartRecording = false;

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            if (audioChunks.length > 0) sendAudioToServer(new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' }));
            audioChunks = [];
            if (shouldRestartRecording) setTimeout(restartRecording, 0);
        };

        mediaRecorder.start(); recordingStartTime = Date.now();
        monitorSilence();
        recordButton.disabled = true; stopButton.disabled = false; recordButton.classList.add('recording-active');
    } catch (e) {
        console.error('Erreur micro:', e);
        alert('Erreur d\'accès au microphone.');
    }
});

// Manual stop
stopButton.addEventListener('click', stopRecording);

function stopRecording() {
    clearInterval(recordingInterval);
    try { if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop(); } catch {}
    if (audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    recordButton.disabled = false; stopButton.disabled = true;
    shouldRestartRecording = false;
    recordButton.classList.remove('recording-active');
    ttsInProgress = false; ttsQueue = [];
    textBuffer = ""; lastVoiceNumber = null;
}

// Audio upload (parallel, one request per API)
async function sendAudioToServer(audioBlob) {
    try {
        const fd1 = new FormData(), fd2 = new FormData();
        fd1.append('file', audioBlob, 'file.opus'); fd1.append('target_lang', langSelect.value || 'fr');
        fd2.append('file', audioBlob, 'file.opus'); fd2.append('target_lang', langSelect.value || 'fr');
        const [diarRes, transRes] = await Promise.all([
            fetch('https://api-diarization.cloud-pi-native.com/upload-audio/', { method: 'POST', body: fd1 }),
            fetch('https://api-translate-rt.cloud-pi-native.com/upload', { method: 'POST', body: fd2 })
        ]);
        if (!diarRes.ok || !transRes.ok) throw new Error(`Erreur API: diarization(${diarRes.status}), translate(${transRes.status})`);
        const [diarization, translation] = await Promise.all([diarRes.json(), transRes.json()]);
        displayTranscriptionResult({ diarization, translation });
    } catch (e) {
        console.error('Erreur upload audio:', e);
        transcriptionResult.textContent += 'Erreur : ' + e.message + '\n\n';
    }
}

function resetFlushTimer() {
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(() => {
        if (textBuffer && textBuffer.trim().length > 0) {
            pushPhraseToDomAndTTS(textBuffer, lastVoiceNumber ?? 0);
            textBuffer = "";
        }
    }, 10000);
}

function countWords(str) { return str.trim().split(/\s+/).length; }

function isBalanced(text) {
    const pairs = [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”'], ['«', '»'], ['"', '"'], ["'", "'"]];
    return pairs.every(([o, c]) =>
        (text.match(new RegExp(`\\${o}`, 'g')) || []).length ===
        (text.match(new RegExp(`\\${c}`, 'g')) || []).length
    );
}

// Phrase splitting & TTS trigger
function displayTranscriptionResult(result) {
    if (!transcriptionResult || !result?.diarization?.identifier) return;
    const identifier = result.diarization.identifier.slice(-4);
    const cleanedText = (result.translation.text || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    if (!cleanedText) return;

    if (!voiceIndex.has(identifier)) voiceIndex.set(identifier, voiceCounter++);
    const voiceNumber = voiceIndex.get(identifier);

    // Changement de locuteur = flush buffer
    if (lastVoiceNumber !== null && lastVoiceNumber !== voiceNumber && textBuffer)
        { pushPhraseToDomAndTTS(textBuffer, lastVoiceNumber); textBuffer = ""; }
    lastVoiceNumber = voiceNumber;

    textBuffer += (textBuffer && !textBuffer.endsWith(' ')) ? ' ' + cleanedText : cleanedText;

    // Phrase segmentation (optimisée)
    let phraseRegex = /[^.!?…]*?(?:\.\.\.|[.!?…])+["'’”»\)\]\s]*/gmu;
    let match, lastIndex = 0, sentences = [];
    while ((match = phraseRegex.exec(textBuffer)) !== null) {
        if (match[0].trim().length > 0) {
            sentences.push(match[0].trim());
            lastIndex = phraseRegex.lastIndex;
        }
    }
    if (sentences.length === 0 && countWords(textBuffer) >= 20 && isBalanced(textBuffer))
        { sentences.push(textBuffer.trim()); textBuffer = ""; }

    if (sentences.length > 0) {
        sentences.forEach(phrase => pushPhraseToDomAndTTS(phrase, voiceNumber));
        textBuffer = lastIndex > 0 ? textBuffer.slice(lastIndex).trim() : "";
    }
    if (textBuffer.length > MAX_BUFFER_LENGTH)
        { console.warn("Purge automatique du buffer trop long"); pushPhraseToDomAndTTS(textBuffer, voiceNumber); textBuffer = ""; }

    resetFlushTimer();
}

// UI + queue TTS
function pushPhraseToDomAndTTS(phrase, voiceNumber) {
    if (!phrase) return;
    if (transcriptionResult.childNodes.length > MAX_MESSAGES) transcriptionResult.innerHTML = '';
    const color = voiceColors[(voiceNumber - 1) % voiceColors.length] || '#000';
    const lang = langSelect.value || 'en', label = speakerLabels[lang] || 'Speaker';
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<strong style="color: ${color}">${label} ${voiceNumber}:</strong> ${phrase}`;
    msgDiv.style.marginBottom = '5px'; msgDiv.classList.add('tts-line');
    setTimeout(() => { transcriptionResult.appendChild(msgDiv); transcriptionResult.scrollTop = transcriptionResult.scrollHeight; }, 0);
    ttsQueue.push({ phrase, element: msgDiv });
    processTTSQueue();
}

function processTTSQueue() {
    if (ttsInProgress || ttsQueue.length === 0) return;
    const { phrase, element } = ttsQueue.shift();
    speakText(phrase, element);
}

// TTS (with error-safe logic)
async function speakText(text, domElement) {
    if (ttsInProgress) return; ttsInProgress = true;
    const apiKey = 'token_client_a', url = 'https://api-txt2audio.cloud-pi-native.com/v1/audio/speech';
    const payload = { model: "gpt-4o-mini-tts", input: text, voice: "toto", instructions: "Speak in a cheerful and positive tone.", response_format: "wav" };
    try {
        if (mediaRecorder?.state === 'recording') { clearInterval(recordingInterval); mediaRecorder.pause(); }
        const response = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`TTS: ${response.statusText}`);
        const audioBlob = await response.blob(), audioUrl = URL.createObjectURL(audioBlob), audio = new Audio(audioUrl);
        if (domElement) domElement.classList.add('tts-current');
        audio.addEventListener('ended', () => {
            URL.revokeObjectURL(audioUrl); ttsInProgress = false; restartRecording();
            if (domElement) domElement.classList.remove('tts-current');
            processTTSQueue();
        });
        await audio.play();
    } catch (error) {
        console.error('Erreur TTS:', error);
        ttsInProgress = false; restartRecording();
        if (domElement) domElement.classList.remove('tts-current');
        processTTSQueue();
    }
}

// Silence monitoring (optimized)
let smoothingFactor = 0.85, thresholdMultiplier = 1.4, baselineRMS = 0, frequencyThreshold = -58;
function monitorSilence() {
    if (recordingInterval) clearInterval(recordingInterval);
    recordingInterval = setInterval(() => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
        analyser.getFloatTimeDomainData(dataArray);
        let rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v*v, 0) / dataArray.length);
        baselineRMS = baselineRMS === 0 ? rms : smoothingFactor * baselineRMS + (1 - smoothingFactor) * rms;
        let dynamicThreshold = baselineRMS * thresholdMultiplier;
        const freqData = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(freqData);
        const freqRes = audioContext.sampleRate / analyser.fftSize, lowI = Math.floor(300 / freqRes), highI = Math.min(Math.floor(3400 / freqRes), freqData.length - 1);
        let sumDb = 0;
        for (let i = lowI; i <= highI; i++) sumDb += freqData[i];
        let avgDb = sumDb / (highI - lowI + 1);
        const silence = (rms < dynamicThreshold) && (avgDb < frequencyThreshold), now = Date.now();
        if (silence) {
            if (!silenceStart) silenceStart = now;
            else if (now - silenceStart > silenceDuration && now - recordingStartTime > minChunkDuration) {
                shouldRestartRecording = true; clearInterval(recordingInterval); try { mediaRecorder.stop(); } catch {}
                silenceStart = 0; return;
            }
        } else silenceStart = 0;
        if (now - recordingStartTime >= maxChunkDuration) {
            shouldRestartRecording = true; clearInterval(recordingInterval); try { mediaRecorder.stop(); } catch {}
            silenceStart = 0;
        }
    }, 50);
}

// For external use, allows manual restart
async function restartRecording() {
    silenceStart = 0; shouldRestartRecording = false;
    if (mediaRecorder?.state === 'paused') mediaRecorder.resume();
    else if (mediaRecorder?.state === 'inactive') mediaRecorder.start();
    recordingStartTime = Date.now();
    monitorSilence();
}
