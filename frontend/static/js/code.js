// /static/js/code.js — complet & robuste : VAD (vad.MicVAD), RecordRTC|MediaRecorder shim, TTS queue, langue cible persistée
(() => {
  // =========================
  // Utils
  // =========================
  const $  = (q) => document.querySelector(q);
  const $$ = (q) => document.querySelectorAll(q);
  const now = () => Date.now();
  const log = (...a) => console.log('[translate-rt]', ...a);

  const safeHTML = (html) =>
    (typeof DOMPurify !== 'undefined')
      ? DOMPurify.sanitize(html, { ALLOWED_TAGS: ['span','strong','em','b','i'] })
      : html;

  const showErrorMessage = (container, message) => {
    const box = container || $('#transcriptionResult');
    if (!box) return alert(message);
    box.querySelectorAll('.fr-alert--error').forEach(el => el.remove());
    const div = document.createElement('div');
    div.className = 'fr-alert fr-alert--error fr-mt-2w';
    div.setAttribute('role','alert');
    div.style.padding = '0.5rem 1rem';
    div.style.border = '1px solid red';
    div.style.borderRadius = '4px';
    div.textContent = message;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  };

  const downloadJSON = (obj, namePrefix) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${namePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const secureContextOK = () =>
    location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  // =========================
  // DOM
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

  // =========================
  // Config
  // =========================
  const Net = {
    UPLOAD_URL: 'https://api-translate-rt.cloud-pi-native.com/upload',
    TTS_URL:    'https://api-translate-rt.cloud-pi-native.com/tts-proxy',
    TTS_MODEL:  'gpt-4o-mini-tts',
    TTS_VOICE:  'alloy',
    TTS_TONE:   'Speak in a cheerful and positive tone.',
    TTS_FORMAT: 'opus',
    API_KEY:    '', // si nécessaire côté proxy
  };

  const Limits = {
    MAX_MESSAGES: 65536,
    minChunkMs: 1800,       // durée min avant envoi
    maxChunkMs: 6500,       // hard cap
    startGuardMs: 300,      // anti-coupure après (re)start
    TTS_FLUSH_MS: 12000     // refresh "draft" si ça traîne
  };

  // VAD (hystérésis/hangover)
  const VADParams = {
    positiveSpeechThreshold: 0.9,  // entrée parole (↑)
    negativeSpeechThreshold: 0.7,  // sortie parole (↓)
    redemptionFrames: 10,
    minSpeechDuration: 0.30,       // s
    minSilenceDuration: 0.60       // s (hangover)
  };

  const Colors = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c','#fabebe','#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000','#ffd8b1','#000075','#808080'];
  const SpeakerLabels = { fr:'Locuteur', en:'Speaker', 'en-gb':'Speaker', bg:'Говорещ', ro:'Vorbitor', es:'Hablante', de:'Sprecher', it:'Parlante' };
  const speakerLabel = (lang) => SpeakerLabels[lang] || 'Speaker';

  // =========================
  // State
  // =========================
  const State = {
    stream: null,
    recorder: null,
    vad: null,
    isSpeaking: false,
    chunkStartedAt: 0,
    hadSpeech: false,
    guardUntil: 0,

    voiceIndex: new Map(),
    voiceCounter: 1,
    lastVoiceNumber: null,

    textBuffer: '',
    fullTranscriptionLog: [],
    draftBySpeaker: new Map(),

    ttsQueue: [],
    ttsBusy: false,

    flushTimeout: null,

    deps: {
      dompurify: () => typeof DOMPurify !== 'undefined',
      howler:    () => typeof Howl !== 'undefined',
      recordrtc: () => typeof RecordRTC !== 'undefined',
      vadweb:    () => typeof vad !== 'undefined', // IMPORTANT: global = vad
      ort:       () => typeof ort !== 'undefined' || typeof onnxruntime !== 'undefined'
    }
  };

  const missingDeps = () => {
    const miss = [];
    if (!State.deps.howler())    miss.push('howler (Howl)');
    if (!State.deps.ort())       miss.push('onnxruntime-web (ort.js)');
    if (!State.deps.vadweb())    miss.push('@ricky0123/vad-web (global "vad")');
    // DOMPurify & RecordRTC sont optionnels (shim/unsafe ok)
    return miss;
  };

  const resetVoiceIndexing = () => { State.voiceIndex.clear(); State.voiceCounter = 1; };

  // =========================
  // Target language helpers (select + chips + localStorage)
  // =========================
  function getTargetLang() {
    const v = DOM.langSelect?.value?.trim();
    return v || localStorage.getItem('targetLang') || 'fr';
  }
  function setTargetLang(val) {
    const v = (val || '').trim();
    if (!v) return;
    if (DOM.langSelect) DOM.langSelect.value = v;
    localStorage.setItem('targetLang', v);
    syncTargetLangUI();
  }
  function syncTargetLangUI() {
    const v = getTargetLang();
    document.querySelectorAll('.lang-chip').forEach(chip => {
      const on = chip.dataset.lang === v;
      chip.classList.toggle('selected', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // =========================
  // RecordRTC fallback shim (MediaRecorder)
  // =========================
  class SimpleRecorderShim {
    constructor(stream, opts = {}) {
      this.stream = stream;
      this.mimeType = opts.mimeType || '';
      this.chunks = [];
      this.mr = null;
    }
    startRecording() {
      const supported = [
        this.mimeType,
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm'
      ].find(t => t && (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t))) || '';
      this.mimeType = supported || this.mimeType;
      this.chunks = [];
      this.mr = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : {});
      this.mr.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.mr.start();
    }
    stopRecording(cb) {
      if (!this.mr) return cb && cb();
      this.mr.onstop = () => { cb && cb(); };
      try { this.mr.stop(); } catch { cb && cb(); }
    }
    getBlob() { return new Blob(this.chunks, { type: this.mimeType || 'audio/webm' }); }
    reset() { this.chunks = []; this.mr = null; }
  }
  const makeRecorder = (stream, opts) => {
    if (typeof RecordRTC !== 'undefined' && typeof RecordRTC === 'function') {
      return new RecordRTC(stream, { type: 'audio', ...opts });
    }
    return new SimpleRecorderShim(stream, opts);
  };

  // =========================
  // Recorder
  // =========================
  async function initStream() {
    if (State.stream) try { State.stream.getTracks().forEach(t => t.stop()); } catch {}
    State.stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression:true, echoCancellation:true, autoGainControl:false, channelCount:1, sampleRate:48000 }
    });
  }

  function startRecorder() {
    const mimeType =
      (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' :
      (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus'))  ? 'audio/ogg;codecs=opus'  :
      'audio/webm';

    State.recorder = makeRecorder(State.stream, { mimeType, timeSlice: 0, disableLogs: true });
    State.recorder.startRecording();
    State.chunkStartedAt = now();
    State.hadSpeech = false;
    State.guardUntil = now() + Limits.startGuardMs;
    log('Recorder démarré', mimeType, `(RecordRTC:${typeof RecordRTC !== 'undefined'})`);
  }

  function stopRecorder() {
    try { State.recorder?.stopRecording?.(() => {}); } catch {}
    State.recorder = null;
  }

  async function stopAndSendChunk() {
    return new Promise((resolve) => {
      if (!State.recorder) return resolve();
      State.recorder.stopRecording(async () => {
        const blob = State.recorder.getBlob();
        // restart immédiat
        State.recorder.reset();
        State.recorder.startRecording();
        State.chunkStartedAt = now();

        if (!State.hadSpeech) { State.hadSpeech = false; return resolve(); }

        try {
          const fd = new FormData();
          const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
          fd.append('file', blob, `record.${ext}`);
          fd.append('target_lang', getTargetLang());
          fd.append('primary_lang', DOM.primaryLangSelect?.value || 'fr');

          const r = await fetch(Net.UPLOAD_URL, { method:'POST', body:fd });
          if (!r.ok) throw new Error(`Erreur API: ${r.status}`);
          const j = await r.json();
          Transcription.onResult(j);
        } catch (e) {
          console.error(e);
          showErrorMessage(DOM.transcriptionResult, 'Erreur réseau : ' + (e.message || 'inconnue'));
        } finally {
          State.hadSpeech = false;
          resolve();
        }
      });
    });
  }

  // =========================
  // VAD (vad-web)
  // =========================
  async function startVAD() {
    if (!State.deps.vadweb()) {
      log('VAD indisponible — capture sans découpe VAD.');
      return;
    }
    if (State.vad) try { State.vad.destroy?.(); } catch {}

    State.vad = await vad.MicVAD.new({
      stream: State.stream, // partage le micro
      positiveSpeechThreshold: VADParams.positiveSpeechThreshold,
      negativeSpeechThreshold: VADParams.negativeSpeechThreshold,
      redemptionFrames: VADParams.redemptionFrames,
      minSpeechDuration: VADParams.minSpeechDuration,
      minSilenceDuration: VADParams.minSilenceDuration,
      onSpeechStart: () => { State.isSpeaking = true; State.hadSpeech = true; },
      onSpeechEnd: async () => {
        if (now() < State.guardUntil) return;
        const age = now() - State.chunkStartedAt;
        const longEnough = age >= Limits.minChunkMs;
        const tooLong    = age >= Limits.maxChunkMs;
        if (longEnough || tooLong) {
          await stopAndSendChunk();
          State.guardUntil = now() + Limits.startGuardMs;
        }
        State.isSpeaking = false;
      }
    });
    State.vad.start();
    log('VAD démarré.');

    // hard cap
    const hardCapTimer = setInterval(async () => {
      if (!State.recorder) return;
      const age = now() - State.chunkStartedAt;
      if (age >= Limits.maxChunkMs) await stopAndSendChunk();
    }, 200);
    State.vad._hardCapTimer = hardCapTimer;
  }

  function stopVAD() {
    try { if (State.vad?._hardCapTimer) clearInterval(State.vad._hardCapTimer); } catch {}
    try { State.vad?.pause?.(); } catch {}
    try { State.vad?.destroy?.(); } catch {}
    State.vad = null;
  }

  // =========================
  // Réseau TTS + file
  // =========================
  const TTS = {
    enqueue(text, el) {
      if (!DOM.enableTTS?.checked || !text) return;
      State.ttsQueue.push({ text, el });
      TTS._process();
    },
    _process() {
      if (State.ttsBusy || State.ttsQueue.length === 0) return;
      const { text, el } = State.ttsQueue.shift();
      State.ttsBusy = true;
      Network.ttsSpeak(text,
        () => el?.classList.add('tts-current'),
        () => { State.ttsBusy = false; el?.classList.remove('tts-current'); TTS._process(); },
        () => { State.ttsBusy = false; el?.classList.remove('tts-current'); TTS._process(); }
      );
    },
    cancelAll() {
      State.ttsQueue = [];
      State.ttsBusy = false;
      document.querySelectorAll('.tts-current').forEach(n => n.classList.remove('tts-current'));
    }
  };

  const Network = {
    async ttsSpeak(text, onStart, onEnd, onError) {
      try {
        stopVAD(); stopRecorder();

        const payload = { model: Net.TTS_MODEL, input: text, voice: Net.TTS_VOICE, instructions: Net.TTS_TONE, response_format: Net.TTS_FORMAT };
        const headers = { 'Content-Type': 'application/json' };
        if (Net.API_KEY) headers.Authorization = `Bearer ${Net.API_KEY}`;
        const res = await fetch(Net.TTS_URL, { method:'POST', headers, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`TTS: ${res.status} ${res.statusText}`);

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (typeof Howl === 'undefined') throw new Error('howler non chargé');

        onStart?.();
        await new Promise((ok, ko) => {
          const h = new Howl({ src: [url], format: ['opus','ogg','webm'] });
          h.once('end', ok);
          h.once('loaderror', (_, msg) => ko(new Error(msg)));
          h.play();
        });
        onEnd?.();
      } catch (e) {
        console.error(e);
        onError?.(e);
      } finally {
        // reprise
        try {
          await initStream();
          startRecorder();
          await startVAD();
        } catch (e) {
          console.error('Reprise après TTS impossible:', e);
          showErrorMessage(DOM.transcriptionResult, 'Impossible de reprendre la capture audio. Recharge la page.');
        }
      }
    }
  };

  // =========================
  // Transcription rendering (draft par locuteur)
  // =========================
  const Transcription = {
    resetFlushTimer() {
      if (State.flushTimeout) clearTimeout(State.flushTimeout);
      State.flushTimeout = setTimeout(() => {
        if (State.textBuffer && State.textBuffer.trim().length > 0 && State.lastVoiceNumber != null) {
          Transcription._renderDraft(State.textBuffer, State.lastVoiceNumber);
        }
      }, Limits.TTS_FLUSH_MS);
    },

    onResult(result) {
      if (!DOM.transcriptionResult) return;
      if (result?.diarization?.noise) return;

      const identifier = (result?.diarization?.identifier || '').slice(-4) || 'anon';
      const transcription = (result?.transcription || '').trim();
      if (!transcription) return;

      const targetLang  = getTargetLang();
      const primaryLang = DOM.primaryLangSelect?.value || 'fr';

      const t1 = result?.[`translation_${primaryLang}`];
      const t2 = result?.[`translation_${targetLang}`];
      const translated = (t1 || t2 || '').trim();

      const phraseForTTS = translated && translated !== transcription ? translated : null;
      const phraseToDisplay = phraseForTTS
        ? `${translated} <span style="opacity:0.65;">(${transcription})</span>`
        : transcription;

      if (!State.voiceIndex.has(identifier)) State.voiceIndex.set(identifier, State.voiceCounter++);
      const voiceNumber = State.voiceIndex.get(identifier);

      if (State.lastVoiceNumber !== null && State.lastVoiceNumber !== voiceNumber) {
        if (State.textBuffer) {
          Transcription._pushToDom(State.textBuffer, State.lastVoiceNumber);
          State.textBuffer = "";
        }
        Transcription._finalizeDraft(State.lastVoiceNumber);
      }
      State.lastVoiceNumber = voiceNumber;

      const baseForFinal = (translated || transcription);
      const looksFinal = /[.!?…](?:\s*[”)"\]\}»]*)$/.test(baseForFinal);
      const tooLong = (State.textBuffer.length + phraseToDisplay.length) > 220;

      State.textBuffer = (State.textBuffer ? (State.textBuffer + " ") : "") + phraseToDisplay;

      if (looksFinal || tooLong) {
        if (State.draftBySpeaker.has(voiceNumber)) {
          const draft = State.draftBySpeaker.get(voiceNumber);
          draft.div.remove();
          State.draftBySpeaker.delete(voiceNumber);
        }
        Transcription._pushToDom(State.textBuffer, voiceNumber, phraseForTTS);
        State.textBuffer = "";
        Transcription._finalizeDraft(voiceNumber);
      } else {
        Transcription._renderDraft(State.textBuffer, voiceNumber);
        Transcription.resetFlushTimer();
      }
    },

    _renderDraft(text, voiceNumber) {
      const color = Colors[(voiceNumber - 1) % Colors.length] || '#000';
      const lang  = DOM.primaryLangSelect?.value || 'en';
      const label = speakerLabel(lang);

      let draft = State.draftBySpeaker.get(voiceNumber);
      if (!draft) {
        const div = document.createElement('div');
        div.classList.add('tts-line', 'draft-line');
        div.style.opacity = '0.85';
        div.style.marginBottom = '5px';
        DOM.transcriptionResult.appendChild(div);
        draft = { div, text: '' };
        State.draftBySpeaker.set(voiceNumber, draft);
      }

      draft.text = text;
      draft.div.innerHTML = safeHTML(`<strong style="color:${color}">${label} ${voiceNumber}:</strong> ${text} <span style="opacity:0.5">…</span>`);
      DOM.transcriptionResult.scrollTop = DOM.transcriptionResult.scrollHeight;
    },

    _finalizeDraft(voiceNumber) {
      const draft = State.draftBySpeaker.get(voiceNumber);
      if (!draft) return;
      draft.div.classList.remove('draft-line');
      draft.div.style.opacity = '1';
      State.draftBySpeaker.delete(voiceNumber);
    },

    _pushToDom(phrase, voiceNumber, ttsText) {
      if (!phrase) return;

      while (DOM.transcriptionResult.childNodes.length >= Limits.MAX_MESSAGES)
        DOM.transcriptionResult.removeChild(DOM.transcriptionResult.firstChild);

      const color = Colors[(voiceNumber - 1) % Colors.length] || '#000';
      const lang  = DOM.primaryLangSelect?.value || 'en';
      const label = speakerLabel(lang);

      const msgDiv = document.createElement('div');
      msgDiv.classList.add('tts-line');
      msgDiv.style.marginBottom = '5px';
      msgDiv.innerHTML = safeHTML(`<strong style="color:${color}">${label} ${voiceNumber}:</strong> ${phrase}`);

      setTimeout(() => {
        DOM.transcriptionResult.appendChild(msgDiv);
        DOM.transcriptionResult.scrollTop = DOM.transcriptionResult.scrollHeight;
      }, 0);

      State.fullTranscriptionLog.push({
        speaker: `${label} ${voiceNumber}`,
        phrase,
        timestamp: new Date().toISOString()
      });

      if (DOM.enableTTS?.checked && ttsText) TTS.enqueue(ttsText, msgDiv);
    },
  };

  // =========================
  // UI
  // =========================
  const UI = {
    _updateRecordingIndicator() {
      if (!DOM.recordButton || !DOM.stopButton || !DOM.recordingIndicator) return;
      const isRecording = DOM.recordButton.disabled && !DOM.stopButton.disabled;
      DOM.recordingIndicator.classList.toggle('active', isRecording);
      DOM.recordButton.innerHTML = isRecording
        ? '<span class="fr-icon-loader-3-line fr-icon--sm fr-mr-1w" aria-hidden="true"></span>Enregistrement en cours...'
        : '<span class="fr-icon-play-line fr-icon--sm fr-mr-1w" aria-hidden="true"></span>Commencer l\'enregistrement';
      DOM.recordButton.classList.toggle('fr-btn--secondary', isRecording);
    },
    onRecordingState(isRecording) {
      if (!DOM.recordButton || !DOM.stopButton) return;
      DOM.recordButton.disabled = isRecording;
      DOM.stopButton.disabled = !isRecording;
      UI._updateRecordingIndicator();
    },
    init() {
      // TTS toggle
      if (DOM.enableTTS) {
        const savedTTS = localStorage.getItem('ttsEnabled');
        if (savedTTS !== null) DOM.enableTTS.checked = savedTTS === 'true';
        DOM.enableTTS.addEventListener('change', (e) => {
          localStorage.setItem('ttsEnabled', e.target.checked);
          if (!e.target.checked) TTS.cancelAll();
        });
      }

      // Primary language chips
      DOM.primaryLangChips.forEach(chip => chip.addEventListener('click', () => {
        if (!DOM.primaryLangSelect) return;
        DOM.primaryLangSelect.value = chip.dataset.lang;
        DOM.primaryLangSelect.dispatchEvent(new Event('change'));
      }));
      DOM.primaryLangSelect?.addEventListener('change', (e) => {
        localStorage.setItem('primaryLang', e.target.value);
      });
      const savedPrimary = localStorage.getItem('primaryLang');
      if (savedPrimary && DOM.primaryLangSelect) DOM.primaryLangSelect.value = savedPrimary;

      // Target language (select + chips)
      (function bindTargetLang() {
        const savedTL = localStorage.getItem('targetLang');
        if (savedTL) {
          if (DOM.langSelect) DOM.langSelect.value = savedTL;
        } else if (DOM.langSelect?.value) {
          localStorage.setItem('targetLang', DOM.langSelect.value);
        }
        syncTargetLangUI();

        DOM.langSelect?.addEventListener('change', (e) => setTargetLang(e.target.value));
        document.addEventListener('click', (ev) => {
          const chip = ev.target.closest?.('.lang-chip');
          if (!chip) return;
          const lang = chip.dataset.lang;
          if (!lang) return;
          setTargetLang(lang);
          if (DOM.langSelect) {
            const prev = DOM.langSelect.value;
            if (prev !== lang) DOM.langSelect.dispatchEvent(new Event('change'));
          }
        });
      })();

      // Save log
      DOM.saveLogButton?.addEventListener('click', () => downloadJSON(State.fullTranscriptionLog, 'transcription'));

      // Buttons
      DOM.recordButton?.addEventListener('click', startAll);
      DOM.stopButton?.addEventListener('click', stopAll);

      // Indicator updates
      if (DOM.recordButton && DOM.stopButton && DOM.recordingIndicator) {
        const mo = new MutationObserver(UI._updateRecordingIndicator);
        [DOM.recordButton, DOM.stopButton].forEach(btn => mo.observe(btn, { attributes: true }));
        UI._updateRecordingIndicator();
      }

      UI.onRecordingState(false);
      log('UI initialisée. Deps manquantes ?', missingDeps());
    }
  };

  // =========================
  // Lifecycle
  // =========================
  async function startAll() {
    log('Clic: Commencer l’enregistrement');
    if (!secureContextOK()) {
      showErrorMessage(DOM.transcriptionResult, 'Cette fonctionnalité nécessite HTTPS (ou localhost).');
      return;
    }
    try {
      resetVoiceIndexing();
      await initStream();
      startRecorder();

      // Démarre le VAD si dispo
      await startVAD();

      UI.onRecordingState(true);
      log('Capture démarrée.');
    } catch (e) {
      console.error(e);
      if (e?.name === 'NotAllowedError') {
        showErrorMessage(DOM.transcriptionResult, 'Accès micro refusé. Autorise le micro dans le navigateur.');
      } else if (e?.name === 'NotFoundError') {
        showErrorMessage(DOM.transcriptionResult, 'Aucun micro disponible.');
      } else {
        showErrorMessage(DOM.transcriptionResult, 'Échec du démarrage de l’enregistrement : ' + (e.message || e));
      }
      UI.onRecordingState(false);
    }
  }

  function stopAll() {
    log('Clic: Stop');
    try { stopVAD(); } catch {}
    try { stopRecorder(); } catch {}
    try { State.stream?.getTracks().forEach(t => t.stop()); } catch {}
    State.stream = null;
    State.textBuffer = ''; State.lastVoiceNumber = null;
    State.draftBySpeaker.clear();
    State.ttsBusy = false; State.ttsQueue = [];
    UI.onRecordingState(false);
    log('Capture arrêtée.');
  }

  // =========================
  // Boot
  // =========================
  function boot() {
    UI.init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
