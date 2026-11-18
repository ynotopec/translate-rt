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
    _pushToDom: value => { rendered = value; },
    resetFlushTimer() {},
  };
  new Function('result', 'DOM', 'safeText', 'State', 'Transcription', body)(
    result, { langSelect: { value: target }, primaryLangSelect: { value: primary } }, String, {}, transcription);
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
  assert.match(source, /punctuationSilenceMs:\s*700/);
  assert.match(source, /silenceHoldMs:\s*250/);
});
test('PCM capture never stops or restarts MediaRecorder between windows', () => {
  assert.match(source, /createScriptProcessor/);
  assert.match(source, /encodeWav/);
  assert.doesNotMatch(source, /State\.mediaRecorder\\.stop\(/);
});
test('overlap removes repeated words but preserves unrelated text', () => {
  const part=source.split('    removeOverlap(previous,current) {')[1].split('\n    },')[0];
  const f=new Function('previous','current',part);
  assert.equal(f('the president of the United States','of the United States spoke'), 'spoke');
  assert.equal(f('Hello world','another sentence'), 'another sentence');
});
