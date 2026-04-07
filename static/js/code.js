// /static/js/code.js — patch complet

(() => {
  // =========================
  // Utils
  // =========================
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => document.querySelectorAll(q);
  const now = () => Date.now();

  const getSupportedMimeType = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
  };

  const countWords = (text) => (
    (text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length
  );

  const safeText = (value) => value == null ? '' : String(value);

  const appendText = (parent, text) => {
    parent.appendChild(document.createTextNode(text));
  };

  const downloadJSON = (obj, namePrefix) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${namePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const showErrorMessage = (container, message) => {
    if (!container) return;
    container.querySelectorAll('.fr-alert--error').forEach(el => el.remove());

    const errorDiv = document.createElement('div');
    errorDiv.classList.add('fr-alert', 'fr-alert--error', 'fr-mt-2w');
    errorDiv.setAttribute('role', 'alert');
    errorDiv.style.padding = '0.5rem 1rem';
    errorDiv.style.border = '1px solid red';
    errorDiv.style.borderRadius = '4px';
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
    container.scrollTop = container.scrollHeight;
  };

  // =========================
  // Config & Static Data
  // =========================
  const DOM = {
    recordButton:        $('#recordButton'),
    stopButton:          $('#stopButton'),
    transcriptionResult: $('#transcriptionResult'),
    langSelect:          $('#langSelect'),
    primaryLangSelect:   $('#primaryLangSelect'),
    primaryLangChips:    $$('.primary-lang-chip'),
    enableTTS:           $('#toggleTTS'),
    recordingIndicator:  $('#recordingIndicator'),
    saveLogButton:       $('#saveLogButton'),
  };

  const SpeakerLabels = {
    'af':'Spreker','am':'ተናጋሪ','ar':'المتحدث','az':'Danışan','be':'Выступоўца','bg':'Говорещ','bn':'বক্তা','bs':'Govornik',
    'ca':'Parlant','ceb':'Tigsulti','cs':'Mluvčí','cy':'Siaradwr','da':'Taler','de':'Sprecher','el':'Ομιλητής','en':'Speaker',
    'en-gb':'Speaker','eo':'Parolanto','es':'Hablante','et':'Kõneleja','fa':'گوینده','fi':'Puhuja','fr':'Locuteur','ga':'Cainteoir',
    'gl':'Falante','gu':'વક્તા','ha':'Mai magana','haw':'ʻŌlelo','he':'דובר','hi':'वक्ता','hmn':'Tus hais lus','hr':'Govornik',
    'ht':'Pale','hu':'Beszélő','hy':'Խոսնակ','id':'Pembicara','ig':'Onye na-ekwu okwu','is':'Ræðumaður','it':'Parlante','ja':'話者',
    'jv':'Pambicara','ka':'მომხსენებელი','kk':'Сөйлеуші','km':'អ្នកនិយាយ','kn':'ಭಾಷಣಗಾರ','ko':'화자','ku':'Axivkar','ky':'Сүйлөөчү',
    'la':'Orator','lb':'Spriecher','lo':'ຜູ້ສຽງ','lt':'Kalbėtojas','lv':'Runātājs','mg':'Mpandahateny','mi':'Kaikōrero','mk':'Говорник',
    'ml':'സംഭാഷകൻ','mn':'Яригч','mr':'वक्ते','ms':'Penutur','mt':'Kelliem','my':'ပြောသူ','ne':'वक्ता','nl':'Spreker','no':'Taler',
    'ny':'Wolankhula','pa':'ਵਕਤਾ','pl':'Mówca','ps':'ویناوال','pt':'Falante','ro':'Vorbitor','ru':'Говорящий','rw':'Umuvugizi',
    'sd':'مقر','si':'කථිකයා','sk':'Rečník','sl':'Govorec','sm':'Failauga','sn':'Mutauri','so':'Afhayeen','sq':'Folës','sr':'Govornik',
    'st':'Sebui','su':'Narasumber','sv':'Talare','sw':'Mzungumzaji','ta':'பேச்சாளர்','te':'వక్త','tg':'Суханрон','th':'ผู้พูด',
    'tr':'Konuşmacı','uk':'Доповідач','ur':'مقرر','uz':'Nutq so‘zlovchi','vi':'Người nói','xh':'Umlingani','yi':'רעדנער',
    'yo':'Asọye','zh-cn':'说话人','zh-tw':'說話者','zu':'Isikhulumi'
  };

  const Colors = [
    '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c','#fabebe',
    '#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000','#ffd8b1','#000075','#808080'
  ];

  const Net = {
    UPLOAD_URL: 'https://api-translate-rt.ailab.infocepo.com/upload',
    TTS_URL:    'https://api-translate-rt.ailab.infocepo.com/tts-proxy',
    TTS_MODEL:  'gpt-4o-mini-tts',
    TTS_VOICE:  'alloy',
    TTS_TONE:   'Speak in a cheerful and positive tone.',
    TTS_FORMAT: 'opus',
    API_KEY:    '',
  };

  const Limits = {
    MAX_MESSAGES: 65536,
    MAX_BUFFER_LENGTH: 4,
    minChunkDuration: 1500,
    maxChunkDuration: 6500,
    minSilenceMs: 1000,
    minVoiceMs: 400,
    minSpeechRms: 0.012,
    minSpeechFrames: 6,
    punctuationCheckMs: 3000,
    punctuationSilenceMs: 300,
    TTS_FLUSH_MS: 10000,
    keepCurrentSpeakerMaxWords: 4,
  };

  const VADParams = {
    alphaLevel: 0.85,
    alphaNoise: 0.995,
    speechStartMargin: 3.0,
    speechStopMargin: 2.2,
    silenceHoldMs: 120,
    initNoiseFloor: 0.002,
    intervalMs: 50,
  };

  // =========================
  // State
  // =========================
  const State = {
    mediaRecorder: null,
    audioContext: null,
    analyser: null,
    dataArray: null,
    stream: null,
    audioChunks: [],
    recordingStart: 0,
    shouldRestartRecording: false,
    isRestarting: false,
    hadSpeechSinceResume: false,
    lastChunkHadSpeech: false,
    maxRmsSinceResume: 0,
    totalSpeechFrames: 0,

    // VAD
    levelEMA: 0,
    noiseFloor: VADParams.initNoiseFloor,
    speechStartTime: 0,
    silenceStart: 0,
    isSpeech: false,
    vadTimer: null,

    // Diarisation / affichage
    voiceIndex: new Map(),          // identifier -> confirmed voiceNumber
    voiceCounter: 1,
    textBuffer: '',
    lastVoiceNumber: null,
    flushTimeout: null,
    fullTranscriptionLog: [],

    // TTS
    ttsQueue: [],
    ttsInProgress: false,
    currentAudio: null,

    // Network
    uploadInFlight: 0,
  };

  const resetVoiceIndexing = () => {
    State.voiceIndex.clear();
    State.voiceCounter = 1;
    State.lastVoiceNumber = null;
  };

  // =========================
  // Recorder
  // =========================
  const Recorder = {
    async initStream() {
      if (State.audioContext) {
        try { await State.audioContext.close(); } catch {}
      }

      if (State.stream) {
        State.stream.getTracks().forEach(t => t.stop());
      }

      State.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000
        }
      });

      State.audioContext = new AudioContext();
      State.analyser = State.audioContext.createAnalyser();
      State.analyser.fftSize = 2048;
      State.dataArray = new Float32Array(State.analyser.fftSize);

      State.audioContext.createMediaStreamSource(State.stream).connect(State.analyser);
    },

    async start() {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        alert('Navigateur non compatible.');
        return;
      }

      if (State.mediaRecorder && State.mediaRecorder.state !== 'inactive') {
        return;
      }

      resetVoiceIndexing();
      State.textBuffer = '';
      State.ttsQueue = [];
      State.ttsInProgress = false;
      State.currentAudio = null;
      State.isRestarting = false;

      await Recorder.initStream();

      const mimeType = getSupportedMimeType();
      State.mediaRecorder = new MediaRecorder(State.stream, mimeType ? { mimeType } : {});
      console.log('MediaRecorder mimeType :', State.mediaRecorder.mimeType);

      State.audioChunks = [];
      State.shouldRestartRecording = false;
      State.hadSpeechSinceResume = false;
      State.lastChunkHadSpeech = false;
      VAD.resetSpeechTracking();

      State.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) State.audioChunks.push(e.data);
      };

      State.mediaRecorder.onstop = () => {
        const shouldSend = State.lastChunkHadSpeech && State.audioChunks.length > 0;

        if (shouldSend) {
          const blob = new Blob(State.audioChunks, { type: State.mediaRecorder.mimeType || 'audio/webm' });
          Network.sendAudio(blob);
        }

        State.audioChunks = [];

        if (State.shouldRestartRecording) {
          State.shouldRestartRecording = false;
          setTimeout(() => Recorder.restart(), 0);
        }
      };

      State.mediaRecorder.start();
      State.recordingStart = now();
      VAD.start();
      UI.onRecordingState(true);
    },

    stop() {
      State.shouldRestartRecording = false;
      State.isRestarting = false;

      VAD.stop();
      VAD.resetSpeechTracking();

      try {
        if (State.mediaRecorder?.state !== 'inactive') {
          State.mediaRecorder.stop();
        }
      } catch {}

      if (State.audioContext) {
        try { State.audioContext.close(); } catch {}
      }

      if (State.stream) {
        State.stream.getTracks().forEach(t => t.stop());
      }

      TTS.cancelAll();
      UI.onRecordingState(false);
    },

    restart() {
      if (!State.mediaRecorder) return;
      if (State.isRestarting) return;

      State.isRestarting = true;

      try {
        State.silenceStart = 0;
        State.speechStartTime = 0;
        State.isSpeech = false;
        State.shouldRestartRecording = false;
        State.hadSpeechSinceResume = false;
        State.lastChunkHadSpeech = false;
        VAD.resetSpeechTracking();

        if (State.mediaRecorder.state === 'paused') {
          State.mediaRecorder.resume();
        } else if (State.mediaRecorder.state === 'inactive') {
          State.mediaRecorder.start();
        }

        State.recordingStart = now();
        VAD.start();
      } catch (e) {
        console.error('Recorder.restart error:', e);
      } finally {
        State.isRestarting = false;
      }
    }
  };

  // =========================
  // VAD
  // =========================
  const VAD = {
    start() {
      VAD.stop();
      State.vadTimer = setInterval(VAD._tick, VADParams.intervalMs);
    },

    stop() {
      if (State.vadTimer) {
        clearInterval(State.vadTimer);
        State.vadTimer = null;
      }
    },

    resetSpeechTracking() {
      State.hadSpeechSinceResume = false;
      State.maxRmsSinceResume = 0;
      State.totalSpeechFrames = 0;
      State.isSpeech = false;
      State.speechStartTime = 0;
      State.silenceStart = 0;
    },

    _shouldSendChunk() {
      if (!State.hadSpeechSinceResume) return false;
      if (State.maxRmsSinceResume < Limits.minSpeechRms) return false;
      if (State.totalSpeechFrames < Limits.minSpeechFrames) return false;
      return true;
    },

    _stopAndRestartChunk() {
      State.lastChunkHadSpeech = VAD._shouldSendChunk();
      State.shouldRestartRecording = true;
      VAD.stop();

      try {
        State.mediaRecorder.stop();
      } catch {}

      VAD.resetSpeechTracking();
      State.silenceStart = 0;
      State.speechStartTime = 0;
      State.isSpeech = false;
    },

    _tick() {
      if (!State.mediaRecorder || State.mediaRecorder.state !== 'recording') return;
      if (!State.analyser || !State.dataArray) return;

      State.analyser.getFloatTimeDomainData(State.dataArray);

      let peak = 0;
      let sumSquares = 0;

      for (let i = 0; i < State.dataArray.length; i++) {
        const sample = State.dataArray[i];
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sumSquares += sample * sample;
      }

      const rms = Math.sqrt(sumSquares / State.dataArray.length);

      State.levelEMA = VADParams.alphaLevel * State.levelEMA + (1 - VADParams.alphaLevel) * rms;

      const speechStartThreshold = State.noiseFloor * VADParams.speechStartMargin;
      const speechStopThreshold = State.noiseFloor * VADParams.speechStopMargin;
      const t = now();

      if (State.levelEMA >= speechStartThreshold) {
        if (!State.isSpeech) {
          State.isSpeech = true;
          State.speechStartTime = t;
        }

        State.silenceStart = 0;
        State.maxRmsSinceResume = Math.max(State.maxRmsSinceResume, peak || rms);
        State.totalSpeechFrames++;

        if (!State.hadSpeechSinceResume && (t - State.speechStartTime > Limits.minVoiceMs)) {
          State.hadSpeechSinceResume = true;
        }
      } else if (State.levelEMA <= speechStopThreshold) {
        if (!State.silenceStart) State.silenceStart = t;

        if (State.isSpeech && t - State.silenceStart >= VADParams.silenceHoldMs) {
          State.isSpeech = false;
          State.speechStartTime = 0;
        }

        if (!State.isSpeech) {
          State.noiseFloor = VADParams.alphaNoise * State.noiseFloor + (1 - VADParams.alphaNoise) * State.levelEMA;
        }
      } else if (!State.isSpeech && !State.silenceStart) {
        State.silenceStart = t;
      }

      const chunkLongEnough = t - State.recordingStart > Limits.minChunkDuration;

      if (!State.isSpeech && State.hadSpeechSinceResume && State.silenceStart && chunkLongEnough) {
        const silenceDuration = t - State.silenceStart;

        if (
          silenceDuration >= Limits.punctuationSilenceMs &&
          t - State.recordingStart >= Limits.punctuationCheckMs
        ) {
          VAD._stopAndRestartChunk();
          return;
        }
      }

      if (
        !State.isSpeech &&
        State.hadSpeechSinceResume &&
        State.silenceStart &&
        t - State.silenceStart > Limits.minSilenceMs &&
        chunkLongEnough
      ) {
        VAD._stopAndRestartChunk();
        return;
      }

      if (t - State.recordingStart >= Limits.maxChunkDuration) {
        VAD._stopAndRestartChunk();
      }
    }
  };

  // =========================
  // Réseau
  // =========================
  const Network = {
    async sendAudio(blob) {
      State.uploadInFlight++;
      try {
        const ext =
          blob.type.includes('webm') ? 'webm' :
          blob.type.includes('ogg')  ? 'ogg'  :
          blob.type.includes('opus') ? 'ogg'  :
          'bin';

        const fd = new FormData();
        fd.append('file', blob, `record.${ext}`);
        fd.append('target_lang', DOM.langSelect?.value || 'fr');
        fd.append('primary_lang', DOM.primaryLangSelect?.value || 'fr');

        const res = await fetch(Net.UPLOAD_URL, {
          method: 'POST',
          body: fd
        });

        if (!res.ok) {
          throw new Error(`Erreur API: ${res.status}`);
        }

        const json = await res.json();
        Transcription.onResult(json);
      } catch (e) {
        console.error('Erreur upload audio:', e);
        showErrorMessage(DOM.transcriptionResult, 'Erreur réseau : ' + (e.message || 'inconnue'));
      } finally {
        State.uploadInFlight = Math.max(0, State.uploadInFlight - 1);
      }
    },

    async ttsSpeak(text, onStart, onEnd, onError) {
      const payload = {
        model: Net.TTS_MODEL,
        input: text,
        voice: Net.TTS_VOICE,
        instructions: Net.TTS_TONE,
        response_format: Net.TTS_FORMAT
      };

      try {
        if (State.mediaRecorder?.state === 'recording') {
          VAD.stop();
          State.mediaRecorder.pause();
        }

        const headers = { 'Content-Type': 'application/json' };
        if (Net.API_KEY) {
          headers.Authorization = `Bearer ${Net.API_KEY}`;
        }

        const response = await fetch(Net.TTS_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`TTS: ${response.status} ${response.statusText}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        State.currentAudio = audio;

        onStart?.();

        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(audioUrl);
          if (State.currentAudio === audio) State.currentAudio = null;
          onEnd?.();
        });

        audio.addEventListener('error', () => {
          URL.revokeObjectURL(audioUrl);
          if (State.currentAudio === audio) State.currentAudio = null;
          onError?.(new Error('Audio playback failed'));
        });

        await audio.play();
      } catch (err) {
        console.error('Erreur TTS:', err);
        if (State.currentAudio) {
          try {
            State.currentAudio.pause();
            State.currentAudio.src = '';
          } catch {}
          State.currentAudio = null;
        }
        onError?.(err);
      }
    }
  };

  // =========================
  // TTS Queue
  // =========================
  const TTS = {
    enqueue(phrase, domElement) {
      if (!DOM.enableTTS?.checked || !phrase) return;
      State.ttsQueue.push({ phrase, element: domElement });
      TTS._process();
    },

    _process() {
      if (State.ttsInProgress || State.ttsQueue.length === 0) return;
      const { phrase, element } = State.ttsQueue.shift();
      TTS._speak(phrase, element);
    },

    _speak(text, element) {
      if (State.ttsInProgress) return;
      State.ttsInProgress = true;

      const onStart = () => {
        element?.classList.add('tts-current');
      };

      const onEnd = () => {
        State.ttsInProgress = false;
        element?.classList.remove('tts-current');
        Recorder.restart();
        TTS._process();
      };

      const onError = () => {
        State.ttsInProgress = false;
        element?.classList.remove('tts-current');
        Recorder.restart();
        TTS._process();
      };

      Network.ttsSpeak(text, onStart, onEnd, onError);
    },

    cancelAll() {
      State.ttsQueue = [];
      State.ttsInProgress = false;

      if (State.currentAudio) {
        try {
          State.currentAudio.pause();
          State.currentAudio.src = '';
        } catch {}
        State.currentAudio = null;
      }

      document.querySelectorAll('.tts-current').forEach(el => el.classList.remove('tts-current'));
    }
  };

  // =========================
  // Transcription rendering
  // =========================
  const Transcription = {
    resetFlushTimer() {
      if (State.flushTimeout) clearTimeout(State.flushTimeout);

      State.flushTimeout = setTimeout(() => {
        if (State.textBuffer && State.textBuffer.trim().length > 0) {
          State.textBuffer = '';
        }
      }, Limits.TTS_FLUSH_MS);
    },

    _resolveVoiceNumber(identifier, transcription) {
      const wordCount = countWords(transcription);

      // Déjà connu → garder le mapping confirmé
      if (identifier && State.voiceIndex.has(identifier)) {
        return State.voiceIndex.get(identifier);
      }

      // Si identifiant absent, on reste sur le locuteur courant si possible
      if (!identifier) {
        if (State.lastVoiceNumber !== null) return State.lastVoiceNumber;
        return State.voiceCounter++;
      }

      // Petit fragment → affichage temporaire sans figer le mapping
      if (
        State.lastVoiceNumber !== null &&
        wordCount > 0 &&
        wordCount <= Limits.keepCurrentSpeakerMaxWords
      ) {
        return State.lastVoiceNumber;
      }

      // Vraie nouvelle phrase → on confirme un nouveau mapping
      const voiceNumber = State.voiceCounter++;
      State.voiceIndex.set(identifier, voiceNumber);
      return voiceNumber;
    },

    onResult(result) {
      if (result?.diarization?.noise) return;

      const transcription = safeText(result?.transcription || '').trim();
      if (!transcription) return;

      const rawIdentifier = result?.diarization?.identifier;
      const identifier = rawIdentifier ? String(rawIdentifier).slice(-4) : '';

      const targetLang = DOM.langSelect?.value || 'fr';
      const primaryLang = DOM.primaryLangSelect?.value || 'fr';

      const tradKeys = [`translation_${primaryLang}`, `translation_${targetLang}`];
      const translated = tradKeys.map(k => result?.[k]).find(Boolean) || transcription;

      const phraseForTTS = (translated && translated !== transcription) ? translated : null;
      const voiceNumber = Transcription._resolveVoiceNumber(identifier, transcription);

      if (voiceNumber == null) return;
      State.lastVoiceNumber = voiceNumber;

      Transcription._pushToDom({
        translated,
        original: transcription,
        voiceNumber,
        ttsText: phraseForTTS
      });

      Transcription.resetFlushTimer();
    },

    _pushToDom({ translated, original, voiceNumber, ttsText }) {
      if (!DOM.transcriptionResult) return;

      while (DOM.transcriptionResult.childNodes.length >= Limits.MAX_MESSAGES) {
        DOM.transcriptionResult.removeChild(DOM.transcriptionResult.firstChild);
      }

      const color = Colors[(voiceNumber - 1) % Colors.length] || '#000';
      const lang = DOM.primaryLangSelect?.value || 'en';
      const label = SpeakerLabels[lang] || 'Speaker';

      const msgDiv = document.createElement('div');
      msgDiv.style.marginBottom = '5px';
      msgDiv.classList.add('tts-line');

      const strong = document.createElement('strong');
      strong.style.color = color;
      strong.textContent = `${label} ${voiceNumber}:`;
      msgDiv.appendChild(strong);
      appendText(msgDiv, ' ');

      if (ttsText) {
        appendText(msgDiv, translated);

        const span = document.createElement('span');
        span.style.opacity = '0.65';
        span.textContent = ` (${original})`;
        msgDiv.appendChild(span);
      } else {
        appendText(msgDiv, original);
      }

      setTimeout(() => {
        DOM.transcriptionResult.appendChild(msgDiv);
        DOM.transcriptionResult.scrollTop = DOM.transcriptionResult.scrollHeight;
      }, 0);

      State.fullTranscriptionLog.push({
        speaker: `${label} ${voiceNumber}`,
        translated: translated || '',
        original: original || '',
        phrase: ttsText ? `${translated} (${original})` : original,
        timestamp: new Date().toISOString()
      });

      if (DOM.enableTTS?.checked && ttsText) {
        TTS.enqueue(ttsText, msgDiv);
      }
    }
  };

  // =========================
  // UI
  // =========================
  const UI = {
    init() {
      DOM.primaryLangChips.forEach(chip => chip.addEventListener('click', () => {
        if (!DOM.primaryLangSelect) return;
        DOM.primaryLangSelect.value = chip.dataset.lang;
        UI._highlightPrimaryChip();
        DOM.primaryLangSelect.dispatchEvent(new Event('change'));
      }));

      if (DOM.primaryLangSelect) {
        DOM.primaryLangSelect.addEventListener('change', UI._highlightPrimaryChip);

        const saved = localStorage.getItem('primaryLang');
        if (saved) DOM.primaryLangSelect.value = saved;

        UI._highlightPrimaryChip();

        DOM.primaryLangSelect.addEventListener('change', e => {
          localStorage.setItem('primaryLang', e.target.value);
        });
      }

      if (DOM.recordButton && DOM.stopButton && DOM.recordingIndicator) {
        const mo = new MutationObserver(UI._updateRecordingIndicator);
        [DOM.recordButton, DOM.stopButton].forEach(btn => {
          mo.observe(btn, { attributes: true });
        });
        UI._updateRecordingIndicator();
      }

      if (DOM.enableTTS) {
        const savedTTS = localStorage.getItem('ttsEnabled');
        if (savedTTS !== null) DOM.enableTTS.checked = savedTTS === 'true';

        DOM.enableTTS.addEventListener('change', (e) => {
          localStorage.setItem('ttsEnabled', e.target.checked);
          if (!e.target.checked) TTS.cancelAll();
        });
      }

      const chips = $$('.lang-chip');
      chips.forEach(chip => chip.addEventListener('click', () => {
        if (!DOM.langSelect) return;
        DOM.langSelect.value = chip.dataset.lang;
        UI._highlightLangChips();
        DOM.langSelect.dispatchEvent(new Event('change'));
      }));

      if (DOM.langSelect) {
        DOM.langSelect.addEventListener('change', UI._highlightLangChips);
        UI._highlightLangChips();
      }

      DOM.saveLogButton?.addEventListener('click', () => {
        downloadJSON(State.fullTranscriptionLog, 'transcription');
      });
    },

    _highlightPrimaryChip() {
      if (!DOM.primaryLangSelect) return;
      DOM.primaryLangChips.forEach(c => {
        c.classList.toggle('selected', DOM.primaryLangSelect.value === c.dataset.lang);
      });
    },

    _highlightLangChips() {
      if (!DOM.langSelect) return;
      document.querySelectorAll('.lang-chip').forEach(c => {
        c.classList.toggle('selected', DOM.langSelect.value === c.dataset.lang);
      });
    },

    _updateRecordingIndicator() {
      if (!DOM.recordButton || !DOM.stopButton || !DOM.recordingIndicator) return;

      const isRecording = DOM.recordButton.disabled && !DOM.stopButton.disabled;
      DOM.recordingIndicator.classList.toggle('active', isRecording);

      DOM.recordButton.textContent = isRecording
        ? 'Enregistrement en cours...'
        : "Commencer l'enregistrement";

      DOM.recordButton.classList.toggle('fr-btn--secondary', isRecording);
    },

    onRecordingState(isRecording) {
      if (DOM.recordButton) DOM.recordButton.disabled = isRecording;
      if (DOM.stopButton) DOM.stopButton.disabled = !isRecording;
      DOM.recordButton?.classList.toggle('recording-active', isRecording);
      UI._updateRecordingIndicator();
    }
  };

  // =========================
  // Events
  // =========================
  document.addEventListener('DOMContentLoaded', () => {
    UI.init();
    DOM.recordButton?.addEventListener('click', Recorder.start);
    DOM.stopButton?.addEventListener('click', Recorder.stop);
  });
})();
