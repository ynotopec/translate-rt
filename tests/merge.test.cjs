const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// End-to-end check of the renderer: consecutive API chunks belonging to the
// same spoken sentence must land on one line, not one line per chunk.
const source = fs.readFileSync(path.join(__dirname, '../static/js/code.js'), 'utf8');
const sentenceBody = source.split('  const Sentence = {')[1].split('\n  };')[0];
const transcriptionBody = source
  .split('  const Transcription = {')[1]
  .split('\n  };\n\n  // =========================\n  // UI')[0];

const Limits = { MAX_MESSAGES: 100, maxSentenceWords: 70, maxSentenceChars: 320, sentenceGraceMs: 2500 };

function element(tag) {
  const el = {
    tagName: tag,
    children: [],
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    textContent: '',
    scrollIntoView() {},
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      return child;
    },
  };
  el.childNodes = el.children;
  return el;
}

function setup() {
  const container = element('div');
  container.scrollTop = 0;
  container.scrollHeight = 0;

  const State = { currentLine: null, fullTranscriptionLog: [], recordingActive: true };
  const enqueued = [];

  const Sentence = new Function('Limits', `const Sentence = {${sentenceBody}}; return Sentence;`)(Limits);
  const Transcription = new Function(
    'DOM', 'State', 'Limits', 'TTS', 'Colors', 'SpeakerLabels', 'countWords', 'appendText', 'Sentence', 'document', 'now',
    `const Transcription = {${transcriptionBody}}; return Transcription;`
  )(
    { transcriptionResult: container, primaryLangSelect: { value: 'fr' }, enableTTS: { checked: true } },
    State, Limits,
    { enqueue: (text, el) => enqueued.push({ text, el }) },
    ['red'], { fr: 'Locuteur' },
    text => (text || '').trim().split(/\s+/).filter(Boolean).length,
    (parent, text) => parent.appendChild({ textContent: text }),
    Sentence,
    { createElement: element, createTextNode: text => ({ textContent: text }) },
    () => 0
  );

  return { Transcription, State, container, enqueued };
}

const tick = () => new Promise(r => setTimeout(r, 0));

test('fragments of one sentence share a single line', async () => {
  const { Transcription, container } = setup();

  Transcription._pushToDom({ translated: 'Nous parlons du budget', original: 'We talk about the budget', voiceNumber: 1, ttsText: 'Nous parlons du budget' });
  Transcription._pushToDom({ translated: 'et des effectifs', original: 'and staffing', voiceNumber: 1, ttsText: 'et des effectifs' });
  await tick();

  assert.equal(container.childNodes.length, 1);
  assert.equal(container.childNodes[0].children[2].textContent, 'Nous parlons du budget et des effectifs');
});

test('a terminal punctuation opens a new line for the next chunk', async () => {
  const { Transcription, container } = setup();

  Transcription._pushToDom({ translated: 'Nous parlons du budget.', original: 'We talk about the budget.', voiceNumber: 1, ttsText: 'Nous parlons du budget.' });
  Transcription._pushToDom({ translated: 'Ensuite les effectifs.', original: 'Then staffing.', voiceNumber: 1, ttsText: 'Ensuite les effectifs.' });
  await tick();

  assert.equal(container.childNodes.length, 2);
  assert.equal(container.childNodes[0].children[2].textContent, 'Nous parlons du budget.');
});

test('a different speaker never merges into the previous line', async () => {
  const { Transcription, container } = setup();

  Transcription._pushToDom({ translated: 'Nous parlons du budget', original: 'We talk', voiceNumber: 1, ttsText: 'Nous parlons du budget' });
  Transcription._pushToDom({ translated: 'Je ne suis pas d accord', original: 'I disagree', voiceNumber: 2, ttsText: 'Je ne suis pas d accord' });
  await tick();

  assert.equal(container.childNodes.length, 2);
});

test('a complete sentence is logged and spoken once, not per chunk', async () => {
  const { Transcription, State, enqueued } = setup();

  Transcription._pushToDom({ translated: 'Nous parlons du budget', original: 'We talk', voiceNumber: 1, ttsText: 'Nous parlons du budget' });
  Transcription._pushToDom({ translated: 'et des effectifs.', original: 'and staffing', voiceNumber: 1, ttsText: 'et des effectifs.' });

  assert.equal(State.fullTranscriptionLog.length, 0);
  assert.equal(enqueued.length, 0);

  Transcription._closeLine();

  assert.equal(State.fullTranscriptionLog.length, 1);
  assert.equal(State.fullTranscriptionLog[0].translated, 'Nous parlons du budget et des effectifs.');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].text, 'Nous parlons du budget et des effectifs.');
});

test('no speech is queued after the user stopped recording', async () => {
  const { Transcription, State, enqueued } = setup();

  Transcription._pushToDom({ translated: 'Dernière phrase', original: 'Last sentence', voiceNumber: 1, ttsText: 'Dernière phrase' });
  State.recordingActive = false;
  Transcription._closeLine();

  assert.equal(enqueued.length, 0);
  assert.equal(State.fullTranscriptionLog.length, 1);
});