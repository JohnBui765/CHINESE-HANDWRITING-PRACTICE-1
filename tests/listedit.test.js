// Tests for js/listedit.js (run: node --test tests/listedit.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitWord, splitEntries, removeRepeats, allInList, fillIn, pinyinPrompt,
  isPinyinPromptExample, PINYIN_PROMPT_EXAMPLE,
} from '../js/listedit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = (word, pinyin = '', meaning = '', more = {}) => ({
  word, pinyin, meaning, page: null, unsure: false, compare: null, other: '', rows: 3, ...more,
});
const words = list => list.map(e => e.word);

test('splitWord: one entry per character, pinyin from the word, no meaning', () => {
  const parts = splitWord(entry('女朋友', 'nǚ péngyou', 'girlfriend', { rows: 6, page: 2, unsure: true }));
  assert.deepEqual(words(parts), ['女', '朋', '友']);
  assert.deepEqual(parts.map(p => p.pinyin), ['nǚ', 'péng', 'you']);
  assert.ok(parts.every(p => p.meaning === '' && p.splitFrom === '女朋友'));
  assert.ok(parts.every(p => p.rows === 6 && p.page === 2 && p.unsure === true));
});

test('splitWord: pinyin that cannot be split is left empty; one character stays as it is', () => {
  const parts = splitWord(entry('你好', 'hǎo', 'hello'));
  assert.deepEqual(parts.map(p => p.pinyin), ['', '']);
  assert.ok(parts.every(p => p.splitFrom === '你好'));
  const one = entry('国', 'guó', 'country');
  assert.deepEqual(splitWord(one), [one]);
});

test('splitEntries: one word, in its place', () => {
  const list = [entry('哪', 'nǎ'), entry('女朋友', 'nǚ péngyou'), entry('国', 'guó')];
  const result = splitEntries(list, 1);
  assert.deepEqual(words(result.entries), ['哪', '女', '朋', '友', '国']);
  assert.equal(result.split, 1);
  assert.equal(result.removed, 0);
});

test('splitEntries: all words, repeats removed, first place kept', () => {
  const list = [
    entry('姐姐', 'jiějie', 'older sister'),
    entry('中国', 'Zhōngguó', 'China'),
    entry('国', 'guó', 'country'),     // already in the list on its own
    entry('想', 'xiǎng', 'to want'),
  ];
  const result = splitEntries(list);
  assert.deepEqual(words(result.entries), ['姐', '中', '国', '想']);
  assert.equal(result.split, 2);
  assert.equal(result.removed, 2);       // the second 姐, and the separate 国
  // 国 keeps its place (from 中国) but takes the pinyin and meaning of the separate entry.
  const guo = result.entries[2];
  assert.equal(guo.pinyin, 'guó');
  assert.equal(guo.meaning, 'country');
  assert.equal(guo.splitFrom, '');
  // The others still say where their pinyin came from.
  assert.equal(result.entries[0].splitFrom, '姐姐');
  assert.equal(result.entries[1].splitFrom, '中国');
});

test('splitEntries: a character that comes earlier in the list stays where it is', () => {
  const result = splitEntries([entry('国', 'guó', 'country'), entry('中国', 'Zhōngguó', 'China')]);
  assert.deepEqual(words(result.entries), ['国', '中']);
  assert.equal(result.entries[0].splitFrom, undefined);
  assert.equal(result.removed, 1);
});

test('removeRepeats fills an empty pinyin or meaning from a repeat', () => {
  const result = removeRepeats([entry('友', '', '', { splitFrom: '朋友' }), entry('友', 'yǒu', 'friend')]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].pinyin, 'yǒu');
  assert.equal(result.entries[0].meaning, 'friend');
  assert.equal(result.entries[0].splitFrom, '');
});

test('allInList and fillIn: a reply about the list fills in pinyin and meaning, keeps the rest', () => {
  const list = [
    { ...entry('女', 'nǚ', ''), splitFrom: '女朋友', rows: 6 },
    { ...entry('友', 'you', ''), splitFrom: '女朋友', rows: 'Page' },
    entry('国', 'guó', 'country'),
  ];
  const reply = [entry('友', 'yǒu', 'friend'), entry('女', 'nǚ', 'woman')];
  assert.equal(allInList(list, reply), true);
  assert.equal(allInList(list, [entry('山', 'shān', 'mountain')]), false);
  assert.equal(allInList(list, []), false);
  const result = fillIn(list, reply);
  assert.equal(result.updated, 2);
  assert.deepEqual(words(result.entries), ['女', '友', '国']);
  assert.equal(result.entries[1].pinyin, 'yǒu');
  assert.equal(result.entries[1].meaning, 'friend');
  assert.equal(result.entries[1].splitFrom, '');
  assert.equal(result.entries[1].rows, 'Page');
  assert.equal(result.entries[2].meaning, 'country');
});

test('pinyinPrompt asks only about words that need it', () => {
  const list = [
    entry('国', 'guó', 'country'),
    entry('哪', 'nǎ', ''),
    { ...entry('友', 'you', ''), splitFrom: '朋友' },
    entry('她', '', 'she'),
  ];
  assert.equal(pinyinPrompt('PROMPT\n', list), 'PROMPT\n哪\n友\n她\n');
  assert.equal(pinyinPrompt('PROMPT', [entry('国', 'guó', 'country')]), '');
});

test('the pinyin prompt file uses the example the app knows, with characters not in the samples', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'prompts', 'pinyin-meaning.txt'), 'utf-8');
  for (const ch of PINYIN_PROMPT_EXAMPLE) assert.ok(prompt.includes(`\n${ch} |`), ch);
  const sampleWords = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'sample_key.txt'), 'utf-8');
  for (const ch of PINYIN_PROMPT_EXAMPLE) assert.ok(!sampleWords.includes(ch), ch);
  assert.ok(prompt.trimEnd().endsWith('THE LIST:'));
});

test('isPinyinPromptExample: a reply with only the example characters', () => {
  const list = [entry('女')];
  assert.equal(isPinyinPromptExample([entry('山', 'shān', 'mountain'), entry('水', 'shuǐ', 'water')], list), true);
  assert.equal(isPinyinPromptExample([entry('女', 'nǚ', 'woman')], list), false);
  assert.equal(isPinyinPromptExample([entry('山', 'shān', 'mountain')], [entry('山')]), false);
});

// Found by the independent review (each one was wrong before the fix).
test('removing repeats keeps the AI warnings of the repeat', () => {
  const result = splitEntries([
    entry('中国', 'Zhōngguó', 'China'),
    entry('国', 'guó', 'country', { unsure: true, compare: 'differs', other: '图' }),
  ]);
  const guo = result.entries[1];
  assert.equal(guo.word, '国');
  assert.equal(guo.unsure, true);
  assert.equal(guo.compare, 'differs');
  assert.equal(guo.other, '图');
});

test('pinyin taken from a word keeps its warning when it moves to an earlier repeat', () => {
  const result = splitEntries([entry('友'), entry('朋友', 'péngyou', 'friend')]);
  assert.deepEqual(words(result.entries), ['友', '朋']);
  assert.equal(result.entries[0].pinyin, 'you');
  assert.equal(result.entries[0].splitFrom, '朋友');
  assert.ok(pinyinPrompt('P', result.entries).includes('\n友\n'));
});

test('splitting one word leaves unrelated repeats in the list alone', () => {
  const list = [entry('国', 'guó', '', { rows: 3 }), entry('国', 'guó', '', { rows: 6 }), entry('中文', 'Zhōngwén')];
  const result = splitEntries(list, 2);
  assert.deepEqual(words(result.entries), ['国', '国', '中', '文']);
  assert.deepEqual(result.entries.map(e => e.rows), [3, 6, 3, 3]);
  assert.equal(result.removed, 0);
});

test('a reply with the example lines or remarks still fills in the list', () => {
  const list = [{ ...entry('女', 'nǚ'), splitFrom: '女朋友' }, entry('国', 'guó', 'country')];
  const reply = [entry('女', 'nǚ', 'woman'), entry('山', 'shān', 'mountain'), entry('朋友')];
  assert.equal(allInList(list, reply), true);
  const result = fillIn(list, reply);
  assert.equal(result.updated, 1);
  assert.equal(result.entries[0].meaning, 'woman');
  assert.equal(result.entries[0].splitFrom, '');
});

test('filling in never overwrites pinyin or a meaning the list already has', () => {
  const list = [entry('女朋友', 'nǚ péng you', 'girlfriend')];
  const result = fillIn(list, [entry('女朋友', 'nǚpéngyǒu', 'girl friend')]);
  assert.equal(result.updated, 0);
  assert.equal(result.entries[0].pinyin, 'nǚ péng you');
  assert.equal(result.entries[0].meaning, 'girlfriend');
});

test('pasting the example characters into an empty app is not refused', () => {
  assert.equal(isPinyinPromptExample([entry('山', 'shān', 'mountain')], []), false);
  assert.equal(isPinyinPromptExample([entry('山')], [entry('女')]), false);
  assert.equal(isPinyinPromptExample([entry('山', 'shān', 'mountain')], [entry('女')]), true);
});
