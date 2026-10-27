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

test('destination takes precedence over primary language', () => {
  const result = render({ transcription: 'Hello', detected_lang: 'en', translation_fr: 'Bonjour', translation_es: 'Hola' });
  assert.equal(result.translated, 'Hola');
  assert.equal(result.ttsText, 'Hola');
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
test('missing destination never silently selects another language', () => {
  assert.equal(render({ transcription: 'Hello', translation_fr: 'Bonjour' }).translated, 'Hello');
});
