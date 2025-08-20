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
let recordingStartTime = 0;
//let minChunkDuration = 2000, maxChunkDuration = 8000, shouldRestartRecording = false;
let minChunkDuration = 1500, maxChunkDuration = 8000, shouldRestartRecording = false;
let textBuffer = "", lastVoiceNumber = null, flushTimeout = null;
let fullTranscriptionLog = [];
const secondLang = "fr";

// ===== VAD (EMA double) =====
let levelEMA = 0;                // niveau instantané (EMA rapide)
let noiseFloor = 0.002;          // bruit de fond (EMA lente)
const alphaLevel = 0.85;         // 0.8–0.9
const alphaNoise = 0.995;        // 0.99–0.999 (lent)
const speechMargin = 3.0;        // parle si > 3x bruit
//const minSilenceMs = 800;        // durée de silence pour couper
const minSilenceMs = 450;        // durée de silence pour couper
const minVoiceMs   = 200;        // petite hystérésis
let lastAboveTime = 0;
let lastBelowTime = 0;
let hadSpeechSinceLastResume = false; // parole détectée dans le chunk en cours ?
let lastChunkHadSpeech = false;       // snapshot pour onstop

const voiceColors = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c','#fabebe','#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000','#ffd8b1','#000075','#808080'];
const speakerLabels = { 'af':'Spreker','am':'ተናጋሪ','ar':'المتحدث','az':'Danışan','be':'Выступоўца','bg':'Говорещ','bn':'বক্তা','bs':'Govornik','ca':'Parlant','ceb':'Tigsulti','cs':'Mluvčí','cy':'Siaradwr','da':'Taler','de':'Sprecher','el':'Ομιλητής','en':'Speaker','en-gb':'Speaker','eo':'Parolanto','es':'Hablante','et':'Kõneleja','fa':'گوینده','fi':'Puhuja','fr':'Locuteur','ga':'Cainteoir','gl':'Falante','gu':'વક્તા','ha':'Mai magana','haw':'ʻŌlelo','he':'דובר','hi':'वक्ता','hmn':'Tus hais lus','hr':'Govornik','ht':'Pale','hu':'Beszélő','hy':'Խոսնակ','id':'Pembicara','ig':'Onye na-ekwu okwu','is':'Ræðumaður','it':'Parlante','ja':'話者','jv':'Pambicara','ka':'მომხსენებელი','kk':'Сөйлеуші','km':'អ្នកនិយាយ','kn':'ಭಾಷಣಗಾರ','ko':'화자','ku':'Axivkar','ky':'Сүйлөөчү','la':'Orator','lb':'Spriecher','lo':'ຜູ້ສຽງ','lt':'Kalbėtojas','lv':'Runātājs','mg':'Mpandahateny','mi':'Kaikōrero','mk':'Говорник','ml':'സംഭാഷകൻ','mn':'Яригч','mr':'वक्ते','ms':'Penutur','mt':'Kelliem','my':'ပြောသူ','ne':'वक्ता','nl':'Spreker','no':'Taler','ny':'Wolankhula','pa':'ਵਕਤਾ','pl':'Mówca','ps':'ویناوال','pt':'Falante','ro':'Vorbitor','ru':'Говорящий','rw':'Umuvugizi','sd':'مقر','si':'කථිකයා','sk':'Rečník','sl':'Govorec','sm':'Failauga','sn':'Mutauri','so':'Afhayeen','sq':'Folës','sr':'Govornik','st':'Sebui','su':'Narasumber','sv':'Talare','sw':'Mzungumzaji','ta':'பேச்சாளர்','te':'వక్త','tg':'Суханрон','th':'ผู้พูด','tr':'Konuşmacı','uk':'Доповідач','ur':'مقرر','uz':'Nutq so‘zlovchi','vi':'Người nói','xh':'Umlingani','yi':'רעדנער','yo':'Asọye','zh-cn':'说话人','zh-tw':'說話者','zu':'Isikhulumi' };

// === AUDIO & RECORDER ===
function getSupportedMimeType() {
  const candidates = ['audio/webm;codecs=opus','audio/ogg;codecs=opus'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function resetVoiceIndexing() { voiceIndex.clear(); voiceCounter = 1; }

async function initAudioStream() {
  if (audioContext) try { await audioContext.close(); } catch {}
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000
    }
  });
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048; // standard
  dataArray = new Float32Array(analyser.fftSize);
  audioContext.createMediaStreamSource(stream).connect(analyser);
}

async function startRecording() {
  try {
    resetVoiceIndexing();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      return alert("Navigateur non compatible.");

    await initAudioStream();

    const mimeType = getSupportedMimeType();
    mediaRecorder  = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    console.log('MediaRecorder mimeType :', mediaRecorder.mimeType);

    audioChunks = [];
    shouldRestartRecording = false;
    hadSpeechSinceLastResume = false;

    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) audioChunks.push(e.data); };

    mediaRecorder.onstop = () => {
      // N'émettre que si le chunk avait de la parole
      if (lastChunkHadSpeech && audioChunks.length) {
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        sendAudioToServer(blob);
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

// === AUDIO UPLOAD ===
async function sendAudioToServer(blob) {
  try {
    const ext = blob.type.includes('webm') ? 'webm'
              : blob.type.includes('ogg')  ? 'ogg'
              : blob.type.includes('opus') ? 'ogg' : 'bin';

    const fd = new FormData();
    fd.append('file', blob, `record.${ext}`);
    fd.append('target_lang', langSelect.value || 'fr');
    fd.append('primary_lang', primaryLangSelect?.value || 'fr');

    const res = await fetch('https://api-translate-rt.cloud-pi-native.com/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
    const result = await res.json();
    displayTranscriptionResult(result);
  } catch (e) {
    console.error('Erreur upload audio:', e);
    showErrorMessage("Erreur réseau : " + (e.message || "inconnue"));
  }
}

// === TRANSCRIPTION HANDLING (identique) ===
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

  if (lastVoiceNumber !== null && lastVoiceNumber !== voiceNumber && textBuffer) {
    pushPhraseToDomAndTTS(textBuffer, lastVoiceNumber); textBuffer = "";
  }
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
  fullTranscriptionLog.push({ speaker: `${label} ${voiceNumber}`, phrase, timestamp: new Date().toISOString() });
  if (enableTTS?.checked && ttsText) { ttsQueue.push({ phrase: ttsText, element: msgDiv }); processTTSQueue(); }
}

function processTTSQueue() {
  if (ttsInProgress || ttsQueue.length === 0) return;
  const { phrase, element } = ttsQueue.shift();
  speakText(phrase, element);
}

async function speakText(text, domElement) {
  if (ttsInProgress) return; ttsInProgress = true;
  const apiKey = '', url = 'https://api-translate-rt.cloud-pi-native.com/tts-proxy';
  const payload = { model: "gpt-4o-mini-tts", input: text, voice: "alloy", instructions: "Speak in a cheerful and positive tone.", response_format: "opus" };
  try {
    if (mediaRecorder?.state === 'recording') { clearInterval(recordingInterval); mediaRecorder.pause(); }
    const response = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`TTS: ${response.statusText}`);
    const audioBlob = await response.blob(), audioUrl = URL.createObjectURL(audioBlob), audio = new Audio(audioUrl);
    if (domElement) domElement.classList.add('tts-current');
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl); ttsInProgress = false; restartRecording(); if (domElement) domElement.classList.remove('tts-current'); processTTSQueue();
    });
    await audio.play();
  } catch (error) {
    console.error('Erreur TTS:', error);
    ttsInProgress = false; restartRecording(); if (domElement) domElement.classList.remove('tts-current'); processTTSQueue();
  }
}

// === VAD / SILENCE MONITORING ===
function monitorSilence() {
  if (recordingInterval) clearInterval(recordingInterval);
  recordingInterval = setInterval(() => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

    analyser.getFloatTimeDomainData(dataArray);
    const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v*v, 0) / dataArray.length);

    // EMA rapides/lentes
    levelEMA = alphaLevel * levelEMA + (1 - alphaLevel) * rms;
    const isBelow = levelEMA <= noiseFloor * speechMargin;
    if (isBelow) noiseFloor = alphaNoise * noiseFloor + (1 - alphaNoise) * levelEMA; // n'apprend le bruit que quand c'est calme

    const now = Date.now();
    if (levelEMA > noiseFloor * speechMargin) {
      if (!lastAboveTime) lastAboveTime = now;
      lastBelowTime = 0;
      if (now - lastAboveTime > minVoiceMs) hadSpeechSinceLastResume = true;
    } else {
      if (!lastBelowTime) lastBelowTime = now;
      lastAboveTime = 0;

      // Silence prolongé
      if (now - lastBelowTime > minSilenceMs && now - recordingStartTime > minChunkDuration) {
        if (hadSpeechSinceLastResume) {
          // On coupe UNIQUEMENT si le chunk contient de la parole
          lastChunkHadSpeech = true;
          shouldRestartRecording = true;
          clearInterval(recordingInterval);
          try { mediaRecorder.stop(); } catch {}
          hadSpeechSinceLastResume = false;
          lastBelowTime = 0;
          return;
        }
        // Sinon: on ne coupe pas → pas de mini-chunk vide
      }
    }

    // Coupe dure si chunk trop long — mais n'envoie que si parole
    if (now - recordingStartTime >= maxChunkDuration) {
      lastChunkHadSpeech = hadSpeechSinceLastResume;
      shouldRestartRecording = true;
      clearInterval(recordingInterval);
      try { mediaRecorder.stop(); } catch {}
      lastBelowTime = 0; lastAboveTime = 0;
    }
  }, 50);
}

async function restartRecording() {
  lastBelowTime = 0; lastAboveTime = 0;
  shouldRestartRecording = false;
  hadSpeechSinceLastResume = false;
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
  function highlightPrimaryChip() { primaryLangChips.forEach(c => c.classList.toggle('selected', primaryLangSelect.value === c.dataset.lang)); }
  if (primaryLangSelect) {
    primaryLangSelect.addEventListener('change', highlightPrimaryChip);
    const savedPrimaryLang = localStorage.getItem('primaryLang');
    if (savedPrimaryLang) primaryLangSelect.value = savedPrimaryLang;
    highlightPrimaryChip();
    primaryLangSelect.addEventListener('change', e => localStorage.setItem('primaryLang', e.target.value));
  }

  // Enregistrement: indicateur
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

  // Toggle TTS
  if (enableTTS) {
    const savedTTS = localStorage.getItem('ttsEnabled');
    if (savedTTS !== null) enableTTS.checked = savedTTS === 'true';
    enableTTS.addEventListener('change', (e) => {
      localStorage.setItem('ttsEnabled', e.target.checked);
      if (!e.target.checked) { ttsQueue = []; ttsInProgress = false; document.querySelectorAll('.tts-current').forEach(el => el.classList.remove('tts-current')); }
    });
  }

  // Chips langue destination
  const chips = document.querySelectorAll('.lang-chip');
  chips.forEach(chip => chip.addEventListener('click', () => {
    langSelect.value = chip.dataset.lang;
    chips.forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    langSelect.dispatchEvent(new Event('change'));
  }));
  function highlightChip() { document.querySelectorAll('.lang-chip').forEach(c => c.classList.toggle('selected', langSelect.value === c.dataset.lang)); }
  if (langSelect) { langSelect.addEventListener('change', highlightChip); highlightChip(); }
});

// === LOG SAVE BUTTON ===
document.getElementById('saveLogButton').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(fullTranscriptionLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `transcription-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
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
