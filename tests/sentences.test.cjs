const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the real sentence assembler with only its Limits dependency injected.
const source = fs.readFileSync(path.join(__dirname, '../static/js/code.js'), 'utf8');
const body = source.split('  const Sentence = {')[1].split('\n  };')[0];
const Sentence = new Function('Limits', `const Sentence = {${body}}; return Sentence;`)({
  maxSentenceWords: 70,
  maxSentenceChars: 320,
});

test('terminal punctuation closes a sentence', () => {
  assert.equal(Sentence.isComplete('Nous parlons du budget.'), true);
  assert.equal(Sentence.isComplete('Vraiment ?'), true);
  assert.equal(Sentence.isComplete('Attention !'), true);
  assert.equal(Sentence.isComplete('« Oui ! »'), true);
  assert.equal(Sentence.isComplete('Il a dit :'), false);
  assert.equal(Sentence.isComplete('Nous parlons du budget,'), false);
  assert.equal(Sentence.isComplete(''), false);
});

test('a chunk cut on a comma stays open', () => {
  assert.equal(Sentence.isComplete('Nous parlons du budget, des effectifs'), false);
});

test('overlap at the seam is dropped', () => {
  assert.equal(
    Sentence.stripOverlap('nous allons parler du budget', 'du budget aujourd hui'),
    'aujourd hui'
  );
});

test('overlap match ignores case and punctuation', () => {
  assert.equal(
    Sentence.stripOverlap('le budget de l’État', 'de l’État, en 2026'),
    'en 2026'
  );
});

test('no overlap keeps the text untouched', () => {
  assert.equal(Sentence.stripOverlap('bonjour', 'comment allez vous'), 'comment allez vous');
});

test('joining fragments lowercases the continuation', () => {
  assert.equal(
    Sentence.join('Nous parlons du budget', 'Et ensuite des effectifs'),
    'Nous parlons du budget et ensuite des effectifs'
  );
});

test('joining keeps acronyms and numbers intact', () => {
  assert.equal(Sentence.join('Le transporteur', 'SNCF assure'), 'Le transporteur SNCF assure');
  assert.equal(Sentence.join('Le montant', '2026 euros'), 'Le montant 2026 euros');
});

test('a line stops merging once it is full', () => {
  assert.equal(Sentence.hasRoom({ wordCount: 70, charCount: 200 }), true);
  assert.equal(Sentence.hasRoom({ wordCount: 71, charCount: 200 }), false);
  assert.equal(Sentence.hasRoom({ wordCount: 10, charCount: 321 }), false);
});