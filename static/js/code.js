// === ELEMENTS HTML & GLOBALS ===
const recordButton        = document.getElementById('recordButton');
const stopButton          = document.getElementById('stopButton');
const transcriptionResult = document.getElementById('transcriptionResult');
const langSelect          = document.getElementById('langSelect');
const primaryLangSelect   = document.getElementById('primaryLangSelect');
const primaryLangChips    = document.querySelectorAll('.primary-lang-chip');
const enableTTS           = document.getElementById('toggleTTS');

let mediaRecorder, audioChunks = [], recordingInterval;
let audioContext, analyser, dataArray, stream;
let voiceIndex = new Map(), voiceCounter = 1;
let ttsQueue = [], ttsInProgress = false;
const MAX_MESSAGES = 65536, MAX_BUFFER_LENGTH = 4;
let silenceThreshold = 0.04, silenceDuration = 800, silenceStart = 0, recordingStartTime = 0;
let minChunkDuration = 2000, maxChunkDuration = 8000, shouldRestartRecording = false;
let textBuffer = "", lastVoiceNumber = null, flushTimeout = null;
let fullTranscriptionLog = [];
const secondLang = "fr";


const voiceColors = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c','#fabebe','#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000','#ffd8b1','#000075','#808080'];
const speakerLabels = {
    'af':    'Spreker',           // Afrikaans
    'am':    'ተናጋሪ',           // Amharique
    'ar':    'المتحدث',         // Arabe
    'az':    'Danışan',          // Azerbaïdjanais
    'be':    'Выступоўца',       // Biélorusse
    'bg':    'Говорещ',          // Bulgare
    'bn':    'বক্তা',            // Bengali
    'bs':    'Govornik',         // Bosniaque
    'ca':    'Parlant',          // Catalan
    'ceb':   'Tigsulti',         // Cebuano
    'cs':    'Mluvčí',           // Tchèque
    'cy':    'Siaradwr',         // Gallois
    'da':    'Taler',            // Danois
    'de':    'Sprecher',         // Allemand
    'el':    'Ομιλητής',         // Grec
    'en':    'Speaker',          // Anglais (États-Unis)
    'en-gb': 'Speaker',          // Anglais (Royaume-Uni)
    'eo':    'Parolanto',        // Espéranto
    'es':    'Hablante',         // Espagnol
    'et':    'Kõneleja',         // Estonien
    'fa':    'گوینده',           // Persan
    'fi':    'Puhuja',           // Finnois
    'fr':    'Locuteur',         // Français
    'ga':    'Cainteoir',        // Irlandais
    'gl':    'Falante',          // Galicien
    'gu':    'વક્તા',            // Gujarati
    'ha':    'Mai magana',       // Haoussa
    'haw':   'ʻŌlelo',           // Hawaïen
    'he':    'דובר',             // Hébreu
    'hi':    'वक्ता',            // Hindi
    'hmn':   'Tus hais lus',     // Hmong
    'hr':    'Govornik',         // Croate
    'ht':    'Pale',             // Créole haïtien
    'hu':    'Beszélő',          // Hongrois
    'hy':    'Խոսնակ',           // Arménien
    'id':    'Pembicara',        // Indonésien
    'ig':    'Onye na-ekwu okwu',// Igbo
    'is':    'Ræðumaður',        // Islandais
    'it':    'Parlante',         // Italien
    'ja':    '話者',              // Japonais
    'jv':    'Pambicara',        // Javanais
    'ka':    'მომხსენებელი',     // Géorgien
    'kk':    'Сөйлеуші',         // Kazakh
    'km':    'អ្នកនិយាយ',        // Khmer
    'kn':    'ಭಾಷಣಗಾರ',        // Kannada
    'ko':    '화자',              // Coréen
    'ku':    'Axivkar',          // Kurde
    'ky':    'Сүйлөөчү',         // Kirghiz
    'la':    'Orator',           // Latin
    'lb':    'Spriecher',        // Luxembourgeois
    'lo':    'ຜູ້ສຽງ',          // Lao
    'lt':    'Kalbėtojas',       // Lituanien
    'lv':    'Runātājs',         // Letton
    'mg':    'Mpandahateny',     // Malgache
    'mi':    'Kaikōrero',        // Maori
    'mk':    'Говорник',         // Macédonien
    'ml':    'സംഭാഷകൻ',         // Malayalam
    'mn':    'Яригч',            // Mongol
    'mr':    'वक्ते',             // Marathi
    'ms':    'Penutur',          // Malais
    'mt':    'Kelliem',          // Maltais
    'my':    'ပြောသူ',          // Birman
    'ne':    'वक्ता',             // Népali
    'nl':    'Spreker',          // Néerlandais
    'no':    'Taler',            // Norvégien
    'ny':    'Wolankhula',       // Nyanja
    'pa':    'ਵਕਤਾ',             // Pendjabi
    'pl':    'Mówca',            // Polonais
    'ps':    'ویناوال',          // Pachto
    'pt':    'Falante',          // Portugais
    'ro':    'Vorbitor',         // Roumain
    'ru':    'Говорящий',        // Russe
    'rw':    'Umuvugizi',        // Kinyarwanda
    'sd':    'مقر',              // Sindhi
    'si':    'කථිකයා',           // Cinghalais
    'sk':    'Rečník',           // Slovaque
    'sl':    'Govorec',          // Slovène
    'sm':    'Failauga',         // Samoan
    'sn':    'Mutauri',          // Shona
    'so':    'Afhayeen',         // Somali
    'sq':    'Folës',            // Albanais
    'sr':    'Govornik',         // Serbe
    'st':    'Sebui',            // Sesotho
    'su':    'Narasumber',       // Soundanais
    'sv':    'Talare',           // Suédois
    'sw':    'Mzungumzaji',      // Swahili
    'ta':    'பேச்சாளர்',         // Tamoul
    'te':    'వక్త',             // Télougou
    'tg':    'Суханрон',         // Tadjik
    'th':    'ผู้พูด',            // Thaï
    'tr':    'Konuşmacı',        // Turc
    'uk':    'Доповідач',        // Ukrainien
    'ur':    'مقرر',             // Ourdou
    'uz':    'Nutq so‘zlovchi',  // Ouzbek
    'vi':    'Người nói',        // Vietnamien
    'xh':    'Umlingani',        // Xhosa
    'yi':    'רעדנער',            // Yiddish
    'yo':    'Asọye',            // Yoruba
    'zh-cn': '说话人',            // Chinois simplifié
    'zh-tw': '說話者',            // Chinois traditionnel
    'zu':    'Isikhulumi',       // Zoulou
};

// === AUDIO & RECORDER ===
function getSupportedMimeType() {
    const candidates = [
        'audio/webm;codecs=opus',  // Chrome, Edge, Safari (WebKit)
        'audio/ogg;codecs=opus'    // Firefox
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

async function startRecording() {
    try {
        resetVoiceIndexing();
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
            return alert("Navigateur non compatible.");

        await initAudioStream();

        const mimeType = getSupportedMimeType();          // ← NEW
        mediaRecorder  = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        console.log('MediaRecorder mimeType :', mediaRecorder.mimeType);

        audioChunks = [];
        shouldRestartRecording = false;

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            if (audioChunks.length) {
                const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
                sendAudioToServer(blob);                  // ← on passe le blob « propre »
            }
            audioChunks = [];
            if (shouldRestartRecording) setTimeout(restartRecording, 0);
        };

        mediaRecorder.start();
        recordingStartTime = Date.now();
        monitorSilence();

        recordButton.disabled = true;
        stopButton.disabled   = false;
        recordButton.classList.add('recording-active');
    } catch (e) {
        console.error('Erreur micro :', e);
        alert("Erreur d’accès au microphone.");
    }
}


// === AUDIO & RECORDER ===
function resetVoiceIndexing() { voiceIndex.clear(); voiceCounter = 1; }

async function initAudioStream() {
    if (audioContext) try { await audioContext.close(); } catch {}
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    dataArray = new Float32Array(analyser.fftSize);
    audioContext.createMediaStreamSource(stream).connect(analyser);
}

function stopRecording() {
    clearInterval(recordingInterval);
    try { if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop(); } catch {}
    if (audioContext) try { audioContext.close(); } catch {}
    if (stream) stream.getTracks().forEach(track => track.stop());
    recordButton.disabled = false; stopButton.disabled = true;
    shouldRestartRecording = false;
    recordButton.classList.remove('recording-active');
    ttsInProgress = false; ttsQueue = [];
    textBuffer = ""; lastVoiceNumber = null;
}

// === AUDIO UPLOAD (asynchrone, fetch unique) ===
/*
async function sendAudioToServer(blob) {
    try {
        let blob = audioBlob;
        if (!blob.type || !blob.type.includes('opus')) {
            blob = new Blob([blob], { type: 'audio/opus' });
            console.log('Blob type patché pour Chrome:', blob.type);
        }
        const fd = new FormData();
        fd.append('file', blob, 'file.opus');
        fd.append('target_lang', langSelect.value || 'fr');
        fd.append('primary_lang', primaryLangSelect?.value || 'fr');
        const res = await fetch('https://api-translate-rt.cloud-pi-native.com/upload', {
            method: 'POST',
            body: fd
        });
        if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
        const result = await res.json();
        displayTranscriptionResult(result);
    } catch (e) {
        console.error('Erreur upload audio:', e);
        showErrorMessage("Erreur réseau : " + (e.message || "inconnue"));
    }
}
*/
// === AUDIO UPLOAD (asynchrone, fetch unique) ===
async function sendAudioToServer(blob) {
    try {
        // Détermine l'extension d'après le type réel du blob
        const ext = blob.type.includes('webm') ? 'webm'
                  : blob.type.includes('ogg')  ? 'ogg'
                  : blob.type.includes('opus') ? 'ogg'   // Firefox peut renvoyer audio/opus
                  : 'bin';

        const fd = new FormData();
        fd.append('file', blob, `record.${ext}`);
        fd.append('target_lang', langSelect.value || 'fr');
        fd.append('primary_lang', primaryLangSelect?.value || 'fr');

        const res = await fetch('https://api-translate-rt.cloud-pi-native.com/upload', {
            method: 'POST',
            body  : fd
        });
        if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
        const result = await res.json();
        displayTranscriptionResult(result);
    } catch (e) {
        console.error('Erreur upload audio:', e);
        showErrorMessage("Erreur réseau : " + (e.message || "inconnue"));
    }
}


// === TRANSCRIPTION HANDLING ===
function resetFlushTimer() {
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(() => {
        if (textBuffer && textBuffer.trim().length > 0) {
            pushPhraseToDomAndTTS(textBuffer, lastVoiceNumber ?? 0);
            textBuffer = "";
        }
    }, 10000);
}

function displayTranscriptionResult(result) {
    if (result?.diarization?.noise) return;
    if (!transcriptionResult || !result?.diarization?.identifier) return;
    const identifier    = result.diarization.identifier.slice(-4);
    const translation   = result.translation;
    const targetLang    = langSelect.value || 'fr';
    const primaryLang   = primaryLangSelect?.value || 'fr';
    const detectedLang  = result?.detected_lang || "";
    const transcription = result?.transcription || "";
    if (!transcription.trim()) return;

    let tradKeys = [ "translation_" + primaryLang, "translation_" + targetLang ];
    let translated = tradKeys.map(k => result[k]).find(t => !!t) || transcription;
    let phraseForTTS = (translated && translated !== transcription) ? translated : null;
    let phraseToDisplay = (phraseForTTS)
        ? `${translated} <span style="opacity:0.65;">(${transcription})</span>`
        : transcription;

    if (!voiceIndex.has(identifier)) voiceIndex.set(identifier, voiceCounter++);
    const voiceNumber = voiceIndex.get(identifier);

    if (lastVoiceNumber !== null && lastVoiceNumber !== voiceNumber && textBuffer)
        { pushPhraseToDomAndTTS(textBuffer, lastVoiceNumber); textBuffer = ""; }
    lastVoiceNumber = voiceNumber;

    pushPhraseToDomAndTTS(phraseToDisplay, voiceNumber, phraseForTTS);
    resetFlushTimer();
}


function pushPhraseToDomAndTTS(phrase, voiceNumber, ttsText) {
    if (!phrase) return;
    while (transcriptionResult.childNodes.length >= MAX_MESSAGES) transcriptionResult.removeChild(transcriptionResult.firstChild);
    const color = voiceColors[(voiceNumber - 1) % voiceColors.length] || '#000';
    const lang = primaryLangSelect?.value || 'en';
    const label = speakerLabels[lang] || 'Speaker';
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<strong style="color: ${color}">${label} ${voiceNumber}:</strong> ${phrase}`;
    msgDiv.style.marginBottom = '5px';
    msgDiv.classList.add('tts-line');
    setTimeout(() => {
        transcriptionResult.appendChild(msgDiv);
        transcriptionResult.scrollTop = transcriptionResult.scrollHeight;
    }, 0);
    fullTranscriptionLog.push({
        speaker: `${label} ${voiceNumber}`,
        phrase,
        timestamp: new Date().toISOString()
    });
    if (enableTTS?.checked && ttsText) {
        ttsQueue.push({ phrase: ttsText, element: msgDiv });
        processTTSQueue();
    }
}

function processTTSQueue() {
    if (ttsInProgress || ttsQueue.length === 0) return;
    const { phrase, element } = ttsQueue.shift();
    speakText(phrase, element);
}

// TTS avec gestion sécurisée
async function speakText(text, domElement) {
    if (ttsInProgress) return; ttsInProgress = true;
    const apiKey = '',
          url = 'https://api-translate-rt.cloud-pi-native.com/tts-proxy';
    const payload = { model: "gpt-4o-mini-tts", input: text, voice: "alloy", instructions: "Speak in a cheerful and positive tone.", response_format: "opus" };
    try {
        if (mediaRecorder?.state === 'recording') { clearInterval(recordingInterval); mediaRecorder.pause(); }
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`TTS: ${response.statusText}`);
        const audioBlob = await response.blob(),
              audioUrl = URL.createObjectURL(audioBlob),
              audio = new Audio(audioUrl);
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

// === SILENCE MONITORING ===
//let smoothingFactor = 0.85, thresholdMultiplier = 1.4, baselineRMS = 0, frequencyThreshold = -58;
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
        const freqRes = audioContext.sampleRate / analyser.fftSize,
              lowI = Math.floor(300 / freqRes),
              highI = Math.min(Math.floor(3400 / freqRes), freqData.length - 1);
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

async function restartRecording() {
    silenceStart = 0; shouldRestartRecording = false;
    if (mediaRecorder?.state === 'paused') mediaRecorder.resume();
    else if (mediaRecorder?.state === 'inactive') mediaRecorder.start();
    recordingStartTime = Date.now();
    monitorSilence();
}

// === UI / DOM READY ===
document.addEventListener('DOMContentLoaded', () => {

    // Chips & select (langue principale)
    primaryLangChips.forEach(chip => chip.addEventListener('click', () => {
        primaryLangSelect.value = chip.dataset.lang;
        primaryLangChips.forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        primaryLangSelect.dispatchEvent(new Event('change'));
    }));
    function highlightPrimaryChip() {
        primaryLangChips.forEach(c => c.classList.toggle('selected', primaryLangSelect.value === c.dataset.lang));
    }
    if (primaryLangSelect) {
        primaryLangSelect.addEventListener('change', highlightPrimaryChip);
        const savedPrimaryLang = localStorage.getItem('primaryLang');
        if (savedPrimaryLang) primaryLangSelect.value = savedPrimaryLang;
        highlightPrimaryChip();
        primaryLangSelect.addEventListener('change', e => localStorage.setItem('primaryLang', e.target.value));
    }

    // === Gestion Enregistrement ===
    const recordingIndicator = document.getElementById('recordingIndicator');
    if (recordButton && stopButton && recordingIndicator) {
        [recordButton, stopButton].forEach(btn => new MutationObserver(updateRecordingIndicator).observe(btn, { attributes: true }));
        function updateRecordingIndicator() {
            const isRecording = recordButton.disabled && !stopButton.disabled;
            recordingIndicator.classList.toggle('active', isRecording);
            recordButton.innerHTML = isRecording ?
                '<span class="fr-icon-loader-3-line fr-icon--sm fr-mr-1w" aria-hidden="true"></span>Enregistrement en cours...' :
                '<span class="fr-icon-play-line fr-icon--sm fr-mr-1w" aria-hidden="true"></span>Commencer l\'enregistrement';
            recordButton.classList.toggle('fr-btn--secondary', isRecording);
        }
        updateRecordingIndicator();
    }

    // === Toggle TTS ===
    if (enableTTS) {
        enableTTS.checked = localStorage.getItem('ttsEnabled') === 'true';
        enableTTS.addEventListener('change', (e) => {
            localStorage.setItem('ttsEnabled', e.target.checked);
            if (!e.target.checked) {
                ttsQueue = []; ttsInProgress = false;
                document.querySelectorAll('.tts-current').forEach(el => el.classList.remove('tts-current'));
            }
        });
    }

    // === Langue populaire & recherche ===
    const langSearch = document.getElementById('langSearch');
    const chips = document.querySelectorAll('.lang-chip');
    chips.forEach(chip => chip.addEventListener('click', () => {
        langSelect.value = chip.dataset.lang;
        chips.forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        langSelect.dispatchEvent(new Event('change'));
    }));
    if (langSearch && langSelect) langSearch.addEventListener('input', function () {
        const term = langSearch.value.trim().toLowerCase();
        let hasVisible = false;
        for (let i = 0; i < langSelect.options.length; i++) {
            const opt = langSelect.options[i], visible = !term || opt.textContent.toLowerCase().includes(term);
            opt.style.display = visible ? '' : 'none';
            if (visible) hasVisible = true;
        }
        if (!hasVisible) langSelect.selectedIndex = -1;
    });
    function highlightChip() {
        chips.forEach(c => c.classList.toggle('selected', langSelect.value === c.dataset.lang));
    }
    if (langSelect) {
        langSelect.addEventListener('change', highlightChip);
        highlightChip();
    }

});

// === LOG SAVE BUTTON ===
document.getElementById('saveLogButton').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(fullTranscriptionLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcription-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

// === UI ERROR ===
function showErrorMessage(message) {
    transcriptionResult.querySelectorAll('.fr-alert--error').forEach(el => el.remove());
    const errorDiv = document.createElement('div');
    errorDiv.classList.add('fr-alert', 'fr-alert--error', 'fr-mt-2w');
    errorDiv.setAttribute('role', 'alert');
    errorDiv.style.padding = '0.5rem 1rem';
    errorDiv.style.border = '1px solid red';
    errorDiv.style.borderRadius = '4px';
    errorDiv.textContent = message;
    transcriptionResult.appendChild(errorDiv);
    transcriptionResult.scrollTop = transcriptionResult.scrollHeight;
}

// === UI BUTTONS EVENTS ===
recordButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
