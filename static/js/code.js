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
    'var(--text-default-info)', 'var(--text-default-success)',
    'var(--text-default-warning)', 'var(--text-default-error)'
  ];

  const RuntimeConfig = window.TRANSLATE_RT_CONFIG || {};

  const Net = {
    UPLOAD_URL: RuntimeConfig.UPLOAD_URL || '/api/upload',
    TTS_URL:    RuntimeConfig.TTS_URL || '/api/tts-proxy',
    TTS_MODEL:  'gpt-4o-mini-tts',
    TTS_VOICE:  'alloy',
    TTS_TONE:   'Speak in a cheerful and positive tone.',
    TTS_FORMAT: 'opus',
  };

  const Limits = {
    MAX_MESSAGES: 65536,
    MAX_BUFFER_LENGTH: 4,
    minChunkDuration: 2500,
    maxChunkDuration: 9000,
    minSilenceMs: 800,
    minVoiceMs: 400,
    minSpeechRms: 0.012,
    minSpeechFrames: 6,
    punctuationCheckMs: 3000,
    punctuationSilenceMs: 800,
    TTS_FLUSH_MS: 10000,
    keepCurrentSpeakerMaxWords: 4,
  };

  const VADParams = {
    alphaLevel: 0.85,
    alphaNoise: 0.995,
    speechStartMargin: 3.0,
    speechStopMargin: 2.2,
    silenceHoldMs: 250,
    initNoiseFloor: 0.002,
    intervalMs: 50,
  };

  // =========================
  // State
  // =========================
  const State = {
    mediaRecorder: null,
    pcmSource: null, pcmNode: null, pcmFrames: [], pcmSamples: 0,
    pcmEnergy: 0, pcmPeak: 0, pcmSpeechSamples: 0,
    captureActive: false, capturePaused: false, captureGeneration: 0,
    nextSequence: 0, nextResultSequence: 0, pendingResults: new Map(),
    lastOriginal: '', lastTranslated: '', recentTranscripts: [],
    recentRenderedSources: [], recentTranslatedSources: [], recentTtsPhrases: [],
    lastShortResult: '', lastShortResultAt: 0,
    audioDebug: false,
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
    pendingSpeakerId: null,
    pendingSpeakerCount: 0,
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
    State.pendingSpeakerId = null;
    State.pendingSpeakerCount = 0;
    State.lastVoiceNumber = null;
  };

  // =========================
  // Recorder
  // =========================
  // Continuous microphone capture; independently decodable PCM WAV segments.
  // ScriptProcessor is a compatibility fallback (AudioWorklet migration is separate).
  const Recorder = {
    async start() {
      if (State.captureActive) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        alert('Navigateur non compatible.'); return;
      }
      const generation = ++State.captureGeneration;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: true, echoCancellation: true,
            autoGainControl: true, channelCount: 1 }
        });
        if (generation !== State.captureGeneration) {
          stream.getTracks().forEach(t => t.stop()); return;
        }
        State.stream = stream;
        State.audioContext = new AudioContext();
        State.analyser = State.audioContext.createAnalyser();
        State.analyser.fftSize = 2048;
        State.dataArray = new Float32Array(2048);
        State.pcmSource = State.audioContext.createMediaStreamSource(stream);
        State.pcmNode = State.audioContext.createScriptProcessor(4096, 1, 1);
        State.pcmSource.connect(State.analyser);
        State.pcmSource.connect(State.pcmNode);
        State.pcmNode.connect(State.audioContext.destination);
        State.pcmNode.onaudioprocess = e => {
          if (!State.captureActive || State.capturePaused) return;
          const samples = new Float32Array(e.inputBuffer.getChannelData(0));
          State.pcmFrames.push(samples);
          State.pcmSamples += samples.length;
          let energy = 0;
          for (const value of samples) {
            energy += value * value;
            State.pcmPeak = Math.max(State.pcmPeak, Math.abs(value));
          }
          State.pcmEnergy += energy;
          // A transient peak is not speech. Require sustained energy measured
          // over PCM frames when the timer-driven VAD misses voice activity.
          if (Math.sqrt(energy / samples.length) >= Limits.minSpeechRms)
            State.pcmSpeechSamples += samples.length;
          if (State.pcmSamples >= State.audioContext.sampleRate * 20) Recorder.flush();
        };
        await State.audioContext.resume();
        resetVoiceIndexing();
        State.textBuffer = '';
        State.ttsQueue = []; State.ttsInProgress = false; State.currentAudio = null;
        State.pcmFrames = []; State.pcmSamples = 0;
        State.pcmEnergy = 0; State.pcmPeak = 0; State.pcmSpeechSamples = 0;
        State.nextSequence = 0; State.nextResultSequence = 0;
        State.pendingResults.clear(); State.lastOriginal = '';
        State.lastTranslated = ''; State.recentTranscripts = [];
        State.recentRenderedSources = []; State.recentTranslatedSources = [];
        State.recentTtsPhrases = [];
        State.audioDebug = localStorage.getItem('audioDebug') === '1';
        State.lastShortResult = ''; State.lastShortResultAt = 0;
        State.captureActive = true; State.capturePaused = false;
        State.recordingStart = now();
        VAD.resetSpeechTracking(); VAD.start();
        UI.onRecordingState(true);
      } catch (error) {
        console.error('Audio capture failed:', error);
        Recorder.stop();
        showErrorMessage(DOM.transcriptionResult, 'Impossible de démarrer le microphone.');
      }
    },
    encodeWav(pcm, rate) {
      const bytes = new ArrayBuffer(44 + 2 * pcm.length);
      const v = new DataView(bytes);
      const str = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at+i, s.charCodeAt(i)); };
      str(0,'RIFF'); v.setUint32(4,bytes.byteLength-8,true);
      str(8,'WAVE'); str(12,'fmt '); v.setUint32(16,16,true);
      v.setUint16(20,1,true); v.setUint16(22,1,true);
      v.setUint32(24,rate,true); v.setUint32(28,rate*2,true);
      v.setUint16(32,2,true); v.setUint16(34,16,true);
      str(36,'data'); v.setUint32(40,2*pcm.length,true);
      for (let i=0;i<pcm.length;i++) {
        const s=Math.max(-1,Math.min(1,pcm[i]));
        v.setInt16(44+2*i,s<0?s*32768:s*32767,true);
      }
      return new Blob([bytes],{type:'audio/wav'});
    },
    // Reduce WAV payload size (48kHz -> 16kHz, ~3x smaller). A weighted
    // box filter averages source samples instead of simply decimating.
    downsample(pcm, sourceRate, targetRate=16000) {
      if (sourceRate <= targetRate) return {pcm, rate:sourceRate};
      const length=Math.ceil(pcm.length*targetRate/sourceRate);
      const result=new Float32Array(length);
      const ratio=sourceRate/targetRate;
      for (let i=0;i<length;i++) {
        const left=i*ratio, right=Math.min(pcm.length,(i+1)*ratio);
        let sum=0;
        for (let j=Math.floor(left);j<Math.ceil(right);j++) {
          const weight=Math.min(right,j+1)-Math.max(left,j);
          if (weight>0) sum+=pcm[j]*weight;
        }
        result[i]=sum/(right-left);
      }
      return {pcm:result,rate:targetRate};
    },
    flush(final=false) {
      if (!State.audioContext || !State.pcmSamples) return;
      const pcm=new Float32Array(State.pcmSamples);
      let pos=0;
      for (const frame of State.pcmFrames) { pcm.set(frame,pos); pos+=frame.length; }
      // The VAD decides *when* to cut, not whether audible audio exists.
      // Its speech-frame counter can miss an utterance or reset at a hard cut.
      const durationMs = pcm.length * 1000 / State.audioContext.sampleRate;
      const rms = Math.sqrt(State.pcmEnergy / Math.max(1, State.pcmSamples));
      const speechMs = State.pcmSpeechSamples * 1000 / State.audioContext.sampleRate;
      const audible = durationMs >= 800 && speechMs >= 300 &&
        rms >= 0.006;
      const vadAccepted = VAD._shouldSendChunk();
      if (State.audioDebug) console.debug('[audio-window]', {
        durationMs: Math.round(durationMs), speechMs: Math.round(speechMs),
        rms: Number(rms.toFixed(4)), vadAccepted, audible,
        disposition: vadAccepted || audible ? 'upload' : 'skip'
      });
      if (vadAccepted || audible) {
        const reduced=Recorder.downsample(pcm,State.audioContext.sampleRate);
        Network.queueAudio(Recorder.encodeWav(reduced.pcm,reduced.rate),State.captureGeneration);
      } else if (durationMs >= 500) {
        console.debug('[audio] silence skipped', {durationMs: Math.round(durationMs), speechMs: Math.round(speechMs), rms});
      }
      // Forced speech cuts retain a short context tail for Whisper. Silence boundaries are closed cleanly.
      const overlap=(!final && State.isSpeech)
        ? Math.min(pcm.length,Math.floor(State.audioContext.sampleRate*0.4)) : 0;
      State.pcmFrames=overlap?[pcm.slice(-overlap)]:[];
      State.pcmSamples=overlap;
      State.pcmEnergy=0; State.pcmPeak=0; State.pcmSpeechSamples=0;
      if (overlap) {
        for (let i=pcm.length-overlap;i<pcm.length;i++) {
          State.pcmEnergy+=pcm[i]*pcm[i];
          State.pcmPeak=Math.max(State.pcmPeak,Math.abs(pcm[i]));
        }
      }
      if (overlap) {
        const chunkSize=4096;
        for (let i=pcm.length-overlap;i<pcm.length;i+=chunkSize) {
          let energy=0, count=0;
          for (let j=i;j<Math.min(i+chunkSize,pcm.length);j++) {
            energy+=pcm[j]*pcm[j]; count++;
          }
          if (count && Math.sqrt(energy/count)>=Limits.minSpeechRms)
            State.pcmSpeechSamples+=count;
        }
      }
      State.recordingStart=now();
      VAD.resetSpeechTracking();
    },
    pauseForTTS() {
      if (!State.captureActive || State.capturePaused) return;
      Recorder.flush(true); State.capturePaused=true; VAD.stop();
    },
    restart() {
      if (!State.captureActive || !State.capturePaused) return;
      State.capturePaused=false; State.recordingStart=now();
      VAD.resetSpeechTracking(); VAD.start();
    },
    stop() {
      ++State.captureGeneration;
      if (State.captureActive && !State.capturePaused) Recorder.flush(true);
      State.captureActive=false; State.capturePaused=false;
      VAD.stop(); VAD.resetSpeechTracking();
      if (State.pcmNode) {
        State.pcmNode.onaudioprocess=null; State.pcmNode.disconnect();
      }
      State.pcmSource?.disconnect();
      State.pcmNode=null; State.pcmSource=null;
      State.audioContext?.close().catch(()=>{});
      State.audioContext=null;
      State.stream?.getTracks().forEach(t=>t.stop());
      State.stream=null;
      State.pcmFrames=[]; State.pcmSamples=0;
      State.pcmEnergy=0; State.pcmPeak=0; State.pcmSpeechSamples=0;
      TTS.cancelAll(); UI.onRecordingState(false);
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

    _stopAndRestartChunk() { Recorder.flush(); },

    _tick() {
      if (!State.captureActive || State.capturePaused) return;
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
    queueAudio(blob,generation) {
      const sequence=State.nextSequence++;
      const context=State.recentTranscripts.slice(-2).join(' ').slice(-500);
      Network.sendAudio(blob,sequence,generation,context,performance.now());
    },
    async sendAudio(blob,sequence,generation,context,queuedAt) {
      State.uploadInFlight++;
      let json;
      try {
        const fd=new FormData();
        fd.append('file',blob,'record.wav');
        fd.append('target_lang',DOM.langSelect?.value||'fr');
        fd.append('primary_lang',DOM.primaryLangSelect?.value||'fr');
        fd.append('context',context);
        const res=await fetch(Net.UPLOAD_URL,{
          method:'POST',headers:{'X-Translate-RT':'1'},body:fd
        });
        if (!res.ok) throw new Error('HTTP '+res.status);
        json=await res.json();
        if (State.audioDebug) console.debug('[audio-latency]', {
          sequence, uploadKB:Math.round(blob.size/1024),
          networkMs:Math.round(performance.now()-queuedAt)
        });
      } catch(error) {
        console.error('Erreur upload audio:',error);
        json={error:'Erreur réseau : '+(error.message||'inconnue')};
      } finally {
        State.uploadInFlight=Math.max(0,State.uploadInFlight-1);
        // Results from prior sessions never enter a new conversation.
        if (generation===State.captureGeneration ||
          (generation===State.captureGeneration-1 && !State.captureActive)) {
          State.pendingResults.set(sequence,{result:json,receivedAt:performance.now()});
          Network.drainResults();
        }
      }
    },
    drainResults() {
      while (State.pendingResults.has(State.nextResultSequence)) {
        const item=State.pendingResults.get(State.nextResultSequence);
        State.pendingResults.delete(State.nextResultSequence++);
        const result=item.result;
        if (State.audioDebug) console.debug('[audio-display]', {
          sequence:State.nextResultSequence-1,
          reorderWaitMs:Math.round(performance.now()-item.receivedAt)
        });
        if (result?.error) showErrorMessage(DOM.transcriptionResult,result.error);
        else if (result?.diarization?.noise) {
          if (State.audioDebug) console.debug('[diarization] rejected noise');
        } else if (result?.transcription) {
          Transcription.onResult(result);
          State.recentTranscripts.push(result.transcription);
          if (State.recentTranscripts.length>3) State.recentTranscripts.shift();
        }
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
        // Keep microphone capture active while the TTS request is pending.

        const headers = { 'Content-Type': 'application/json', 'X-Translate-RT': '1' };

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

        // Avoid the TTS -> microphone -> STT feedback loop. The microphone
        // remains active during TTS synthesis, but not while audio is played.
        // Browser echoCancellation cannot reliably cancel external speakers.
        Recorder.pauseForTTS();
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
        Recorder.restart();
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
      State.recentTtsPhrases.push({ text: phrase, time: now() });
      if (State.recentTtsPhrases.length > 8) State.recentTtsPhrases.shift();
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
    // Normalize only for comparison: keep the real transcription unchanged.
    words(text) {
      return (text.match(/[\p{L}\p{N}]+/gu) || []).map(w => w.toLocaleLowerCase());
    },
    // Return the number of leading words that were already heard. Unlike a
    // suffix-only comparison, this recognizes replay from *inside* a prior chunk.
    repeatedPrefix(previous, current) {
      const left = Transcription.words(previous);
      const right = Transcription.words(current);
      if (!left.length || !right.length) return 0;
      let best = 0;
      for (let start = 0; start < left.length; start++) {
        let n = 0;
        while (n < right.length && start+n < left.length &&
               right[n] === left[start+n]) n++;
        // A two-word overlap is enough only at the *exact* chunk
        // boundary; matches inside older text require >=6 words.
        const atBoundary = start + n === left.length;
        if ((atBoundary && n >= 2) || n >= 6) best = Math.max(best,n);
      }
      return best;
    },
    removeOverlap(previous,current) {
      if (!previous || !current) return current;
      const words = Array.from(current.matchAll(/[\p{L}\p{N}]+/gu));
      const count = Transcription.repeatedPrefix(previous,current);
      if (!count) return current;
      if (count >= words.length) return '';
      // Preserve the original accents, punctuation and capitalization.
      return current.slice(words[count].index).trim();
    },
    deduplicate(current, history) {
      let value = current;
      // Match against complete prior chunks; repeat may start in the middle.
      for (const previous of history.slice(-3)) {
        value = Transcription.removeOverlap(previous,value);
        if (!value) return '';
      }
      return value;
    },
    isPlaybackEcho(transcription) {
      const t = now();
      State.recentTtsPhrases = State.recentTtsPhrases.filter(p => t-p.time < 12000);
      const current = Transcription.words(transcription);
      if (current.length < 6) return false;
      return State.recentTtsPhrases.some(p => {
        const spoken = Transcription.words(p.text);
        if (spoken.length < 6) return false;
        const overlap = Transcription.repeatedPrefix(p.text,transcription);
        return overlap >= Math.max(6,Math.ceil(current.length*0.8));
      });
    },
    resetFlushTimer() {
      if (State.flushTimeout) clearTimeout(State.flushTimeout);

      State.flushTimeout = setTimeout(() => {
        if (State.textBuffer && State.textBuffer.trim().length > 0) {
          State.textBuffer = '';
        }
      }, Limits.TTS_FLUSH_MS);
    },

    _resolveVoiceNumber(identifier, transcription, continuation = false) {
      const wordCount = countWords(transcription);
      // Diarization IDs are produced independently for each chunk. When
      // there is a confirmed textual boundary overlap, keep the prior speaker.
      if (continuation && State.lastVoiceNumber !== null) {
        State.pendingSpeakerId = null;
        State.pendingSpeakerCount = 0;
        return State.lastVoiceNumber;
      }

      // Déjà connu → garder le mapping confirmé
      if (identifier && State.voiceIndex.has(identifier)) {
        State.pendingSpeakerId = null;
        State.pendingSpeakerCount = 0;
        return State.voiceIndex.get(identifier);
      }

      // Si identifiant absent, on reste sur le locuteur courant si possible
      if (!identifier) {
        State.pendingSpeakerId = null;
        State.pendingSpeakerCount = 0;
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
      // Per-chunk diarization identifiers are not stable identity evidence.
      // Require a second consecutive chunk with the same new identifier
      // before changing speaker; single-chunk noise keeps the current voice.
      if (State.lastVoiceNumber !== null) {
        if (State.pendingSpeakerId !== identifier) {
          State.pendingSpeakerId = identifier;
          State.pendingSpeakerCount = 1;
          return State.lastVoiceNumber;
        }
        State.pendingSpeakerCount++;
        if (State.pendingSpeakerCount < 2) return State.lastVoiceNumber;
      }
      State.pendingSpeakerId = null;
      State.pendingSpeakerCount = 0;
      const voiceNumber = State.voiceCounter++;
      State.voiceIndex.set(identifier, voiceNumber);
      return voiceNumber;
    },

    onResult(result) {
      // Preserve the diarization service's explicit noise decision. Whisper
      // may hallucinate fluent words on noise; STT text is not proof of speech.
      if (result?.diarization?.noise) return;

      const original = safeText(result?.transcription || '').trim();
      if (!original || Transcription.isPlaybackEcho(original)) return;
      // Suppress ASR loops on silence (e.g. 'you', 'you', 'you'), but
      // preserve the first short utterance and any different utterance.
      const tokens = Transcription.words(original);
      const short = tokens.length <= 2;
      const key = tokens.join(' ');
      const clock = now();
      if (short && key && key === State.lastShortResult &&
          clock - State.lastShortResultAt < 10000) return;
      State.lastShortResult = short ? key : '';
      State.lastShortResultAt = clock;
      const preceding = State.recentRenderedSources.at(-1) || '';
      const continuation = Transcription.repeatedPrefix(preceding, original) >= 2;
      const transcription = Transcription.deduplicate(original,State.recentRenderedSources);
      // Do not play, translate for display, or assign a new speaker to echoes.
      if (!transcription) return;
      State.recentRenderedSources.push(original);
      if (State.recentRenderedSources.length > 4) State.recentRenderedSources.shift();
      State.lastOriginal=original;

      const rawIdentifier = result?.diarization?.identifier;
      const identifier = rawIdentifier ? String(rawIdentifier).slice(-4) : '';

      const targetLang = DOM.langSelect?.value || 'fr';
      const primaryLang = DOM.primaryLangSelect?.value || 'fr';

      // Primary-language speech goes to the destination; every other language
      // goes to the primary language, including an unidentified source.
      const outputLang = result.detected_lang === primaryLang ? targetLang : primaryLang;
      const tradKeys = result.detected_lang === outputLang
        ? [] : [`translation_${outputLang}`];
      const rawTranslation = tradKeys.map(k => result?.[k]).find(Boolean) || '';
      // The provider translated the complete chunk, possibly including the
      // replayed prefix. Avoid showing that stale translation for a trimmed chunk.
      // The original remains visible rather than displaying duplicated content.
      const translated = transcription === original && rawTranslation
        ? Transcription.deduplicate(rawTranslation,State.recentTranslatedSources || [])
        : transcription;

      if (rawTranslation && translated && translated !== transcription) {
        State.recentTranslatedSources.push(rawTranslation);
        if (State.recentTranslatedSources.length > 4) State.recentTranslatedSources.shift();
      }
      const phraseForTTS = (translated && translated !== transcription) ? translated : null;
      const voiceNumber = Transcription._resolveVoiceNumber(identifier, transcription, continuation);

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
      UI._syncPrimaryLanguageOptions();

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

    _syncPrimaryLanguageOptions() {
      if (!DOM.primaryLangSelect || !DOM.langSelect) return;
      const currentPrimary = DOM.primaryLangSelect.value || 'fr';

      DOM.primaryLangSelect.replaceChildren(
        ...Array.from(DOM.langSelect.options, option => option.cloneNode(true))
      );

      if ([...DOM.primaryLangSelect.options].some(o => o.value === currentPrimary)) {
        DOM.primaryLangSelect.value = currentPrimary;
      } else {
        DOM.primaryLangSelect.value = 'fr';
      }
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
