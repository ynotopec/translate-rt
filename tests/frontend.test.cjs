const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the actual renderer with only its DOM boundary replaced.
const source = fs.readFileSync(path.join(__dirname, '../static/js/code.js'), 'utf8');
const body = source.split('    onResult(result) {')[1].split('\n    _pushToDom(')[0].replace(/\n    },\s*$/, '');
function render(result, target = 'es', primary = 'fr') {
  let rendered;
  const transcription = {
    _resolveVoiceNumber: () => 1,
    removeOverlap: (_previous, current) => current,
    deduplicate: (current, _history) => current,
    isPlaybackEcho: () => false,
    repeatedPrefix: () => 0,
    _pushToDom: value => { rendered = value; },
    resetFlushTimer() {},
  };
  new Function('result', 'DOM', 'safeText', 'State', 'Transcription', body)(
    result, { langSelect: { value: target }, primaryLangSelect: { value: primary } }, String,
    { recentRenderedSources: [], recentTranslatedSources: [], recentTtsPhrases: [],
      voiceIndex: new Map(), lastVoiceNumber: null }, transcription);
  return rendered;
}

test('third language is translated to primary even when destination is available', () => {
  const result = render({ transcription: 'Hello', detected_lang: 'en', translation_fr: 'Bonjour', translation_es: 'Hola' });
  assert.equal(result.translated, 'Bonjour');
  assert.equal(result.ttsText, 'Bonjour');
});
test('primary language is translated towards destination with TTS', () => {
  const result = render({ transcription: 'Bonjour', detected_lang: 'fr', translation_es: 'Hola' });
  assert.equal(result.translated, 'Hola');
  assert.equal(result.ttsText, 'Hola');
});
test('destination language is translated back to primary with TTS', () => {
  const result = render({ transcription: 'Hola', detected_lang: 'es', translation_fr: 'Bonjour' });
  assert.equal(result.translated, 'Bonjour');
  assert.equal(result.ttsText, 'Bonjour');
});
test('reverse direction uses the selected primary language', () => {
  const result = render({ transcription: 'Hello', detected_lang: 'en', translation_pt: 'Olá' }, 'en', 'pt');
  assert.equal(result.translated, 'Olá');
  assert.equal(result.ttsText, 'Olá');
});
test('missing reverse translation preserves original without TTS', () => {
  const result = render({ transcription: 'Hola', detected_lang: 'es', translation_es: 'Hola' });
  assert.equal(result.translated, 'Hola');
  assert.equal(result.ttsText, null);
});
test('identical selected languages preserve original without TTS', () => {
  const result = render({ transcription: 'Bonjour', detected_lang: 'fr', translation_fr: 'Bonjour' }, 'fr');
  assert.equal(result.translated, 'Bonjour');
  assert.equal(result.ttsText, null);
});
test('unidentified language is translated to primary', () => {
  const result = render({ transcription: 'Hello', translation_fr: 'Bonjour', translation_es: 'Hola' });
  assert.equal(result.translated, 'Bonjour');
  assert.equal(result.ttsText, 'Bonjour');
});
test('missing destination for primary speech preserves original', () => {
  const result = render({ transcription: 'Bonjour', detected_lang: 'fr', translation_fr: 'Bonjour' });
  assert.equal(result.translated, 'Bonjour');
  assert.equal(result.ttsText, null);
});
test('missing primary translation for third language preserves original', () => {
  const result = render({ transcription: 'Hello', detected_lang: 'en', translation_es: 'Hola' });
  assert.equal(result.translated, 'Hello');
  assert.equal(result.ttsText, null);
});

test('sentence boundaries use a longer maximum window and silence hold', () => {
  assert.match(source, /maxChunkDuration:\s*15000/);
  assert.match(source, /minChunkDuration:\s*4500/);
  assert.match(source, /punctuationSilenceMs:\s*1200/);
  assert.match(source, /punctuationCheckMs:\s*5000/);
  assert.match(source, /silenceHoldMs:\s*250/);
});
test('PCM capture never stops or restarts MediaRecorder between windows', () => {
  assert.match(source, /createScriptProcessor/);
  assert.match(source, /encodeWav/);
  assert.doesNotMatch(source, /State\.mediaRecorder\.stop\(/);
});
test('overlap removes repeated words but preserves unrelated text', () => {
  const extract = (start) => source.split(start)[1].split('\n    },')[0];
  const wordBody=extract('    words(text) {');
  const prefixBody=extract('    repeatedPrefix(previous, current) {');
  const trimBody=extract('    removeOverlap(previous,current) {');
  const helper={};
  helper.words=t=>new Function('text',wordBody)(t);
  helper.repeatedPrefix=(a,b)=>new Function('previous','current','Transcription',prefixBody)(a,b,helper);
  const trim=(a,b)=>new Function('previous','current','Transcription',trimBody)(a,b,helper);
  assert.equal(trim('the president of the United States','of the United States spoke'), 'spoke');
  assert.equal(trim('Hello world','another sentence'), 'another sentence');
});

test('audible audio is submitted even if VAD frame tracking misses it', () => {
  assert.match(source, /const audible = durationMs >= 800/);
  assert.match(source, /speechMs >= 300/);
  assert.match(source, /VAD\._shouldSendChunk\(\) \|\| audible/);
});
test('TTS playback pauses capture only after synthesis, before playback', () => {
  const playback = source.split('    async ttsSpeak(')[1].split('  // =========================\n  // TTS Queue')[0];
  assert.match(playback, /Recorder\.pauseForTTS\(\);\s*await audio\.play\(\)/);
  assert.ok(playback.indexOf('await response.blob()') < playback.indexOf('Recorder.pauseForTTS()'));
});

test('Unicode word tokenization is actually enabled for replay matching', () => {
  assert.match(source, /text\.match\(\/\[\\p\{L\}\\p\{N\}\]\+\/gu\)/);
});

test('two-word overlap at a true chunk boundary is removed', () => {
  const helper=source.split('    repeatedPrefix(previous, current) {')[1].split('\n    },')[0];
  const words=source.split('    words(text) {')[1].split('\n    },')[0];
  const remove=source.split('    removeOverlap(previous,current) {')[1].split('\n    },')[0];
  const t={};
  t.words=new Function('text',words);
  const rp=(a,b)=>new Function('previous','current','Transcription',helper)(a,b,t);
  t.repeatedPrefix=rp;
  assert.equal(rp('I will feed','feed them'),0);
  assert.equal(rp("I'll feed", "I'll feed their interviews"),3);
  assert.equal(rp('It is just a test', 'a test for you'),2);
  assert.equal(rp('It is just a test', 'it is'),0);
  const trim=(a,b)=>new Function('previous','current','Transcription',remove)(a,b,t);
  assert.equal(trim("I'll feed","I'll feed their interviews"),'their interviews');
});

test('new diarization IDs require confirmation before changing speaker', () => {
  const body=source.split('    _resolveVoiceNumber(identifier, transcription, continuation = false) {')[1]
    .split('\n    onResult(result) {')[0].replace(/\n    },\s*$/, '');
  const state={ lastVoiceNumber: 1, voiceCounter: 2, voiceIndex: new Map(),
    pendingSpeakerId: null, pendingSpeakerCount: 0 };
  const resolve=new Function('identifier','transcription','continuation','State','countWords','Limits',body);
  const call=(id,cont=false)=>resolve(id,'long enough example',cont,state,t=>t.split(' ').length,{keepCurrentSpeakerMaxWords:4});
  assert.equal(call('new-id'),1);
  assert.equal(call('new-id'),2);
  assert.equal(call('new-id'),2);
});

test('short repeated ASR hallucinations are throttled, not the first utterance', () => {
  assert.match(source, /tokens\.length <= 2/);
  assert.match(source, /clock - State\.lastShortResultAt < 10000/);
});
