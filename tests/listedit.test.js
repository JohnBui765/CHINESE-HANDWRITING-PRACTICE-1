// Tests for js/listedit.js (run: node --test tests/listedit.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  splitEntries, canSplit, unsplit, deleteEntry, moveEntry, repeatFlags, printedEntries,
  allInList, fillIn, pinyinPrompt, isPinyinPromptExample, PINYIN_PROMPT_EXAMPLE,
} from '../js/listedit.js';
import { readText } from '../js/extract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = (word, pinyin = '', meaning = '', more = {}) => ({
  word, pinyin, said: '', meaning, page: null, unsure: false, compare: null, other: '', depth: 0, rows: 3, ...more,
});
// "女朋友", ">女", ... with the pinyin as said after an arrow: compact and easy to compare.
const show = list => list.map(e => `${'>'.repeat(e.depth)}${e.word}${e.pinyin ? ' ' + e.pinyin : ''}${e.said ? '→' + e.said : ''}`);

test('Split keeps the word and puts its characters under it, with the pinyin of the word', () => {
  const list = [entry('哪', 'nǎ'), entry('女朋友', 'nǚ péngyou', 'girlfriend', { rows: 6 }), entry('国', 'guó')];
  const result = splitEntries(list, 1);
  assert.equal(result.split, 1);
  assert.deepEqual(show(result.entries), ['哪 nǎ', '女朋友 nǚ péngyou', '>女 nǚ', '>朋 péng', '>友 you', '国 guó']);
  const parts = result.entries.slice(2, 5);
  assert.ok(parts.every(p => p.splitFrom === '女朋友' && p.meaning === '' && p.rows === 6 && p.depth === 1));
  // The word itself is unchanged.
  assert.equal(result.entries[1], list[1]);
});

test('Split uses what the list already knows about a character', () => {
  const list = [entry('中国', 'Zhōngguó', 'China'), entry('朋友', 'péngyou'), entry('国', 'guó', 'country'), entry('友', 'yǒu', 'friend')];
  const result = splitEntries(list);
  // 国: the same syllable as the separate 国 row, so its pinyin and meaning are checked.
  const guo = result.entries.find(e => e.word === '国' && e.depth === 1);
  assert.deepEqual([guo.pinyin, guo.said, guo.meaning, guo.splitFrom], ['guó', '', 'country', '']);
  // 友: "you" in 朋友, yǒu on its own -> yǒu → you.
  const you = result.entries.find(e => e.word === '友' && e.depth === 1);
  assert.deepEqual([you.pinyin, you.said, you.meaning, you.splitFrom], ['yǒu', 'you', 'friend', '']);
  // 中: nothing known, so the warning stays.
  assert.equal(result.entries[1].splitFrom, '中国');
});

test('Split: pinyin that does not fit gives empty pinyin; one character cannot be split', () => {
  const result = splitEntries([entry('你好', 'hǎo', 'hello'), entry('国', 'guó')]);
  assert.deepEqual(show(result.entries), ['你好 hǎo', '>你', '>好', '国 guó']);
  assert.ok(result.entries.slice(1, 3).every(p => p.splitFrom === '你好'));
  assert.equal(canSplit(result.entries, 3), false);
  // A word that already has its parts cannot be split again.
  assert.equal(canSplit(result.entries, 0), false);
});

test('Split of a sentence: one part per character, no punctuation; the pinyin as said is split too', () => {
  const sentence = entry('你好！', 'nǐ hǎo', 'Hello!', { said: 'ní hǎo' });
  const result = splitEntries([sentence], 0);
  assert.deepEqual(show(result.entries), ['你好！ nǐ hǎo→ní hǎo', '>你 nǐ→ní', '>好 hǎo']);
});

test('Split all: words and chunks without parts; not repeats, not characters of chunks', () => {
  const list = readText([
    '1 | 我买一本书。 | Wó mǎi yì běn shū. | I buy a book.',
    '> 我 | wǒ → wó | I', '> 买 | mǎi | to buy', '> 一本书 | yì běn shū | a book',
    '1 | 一本书 | yì běn shū | a book',
    '1 | 中国 | Zhōngguó | China',
  ].join('\n')).entries;
  const result = splitEntries(list);
  assert.equal(result.split, 2);   // the chunk 一本书 and 中国; the repeated 一本书 is not split
  assert.deepEqual(show(result.entries), [
    '我买一本书。 Wó mǎi yì běn shū.', '>我 wǒ→wó', '>买 mǎi', '>一本书 yì běn shū', '>>一 yì', '>>本 běn', '>>书 shū',
    '一本书 yì běn shū', '中国 Zhōngguó', '>中 zhōng', '>国 guó',
  ]);
  assert.equal(splitEntries(result.entries).split, 0);
});

test('repeats are printed once: the first time a word appears, unless "Print again"', () => {
  const list = readText('1 | 二十 | èrshí\n> 二 | èr\n> 十 | shí\n1 | 十一 | shíyī\n> 十 | shí\n> 一 | yī\n1 | 十 | shí | ten').entries;
  assert.deepEqual(repeatFlags(list), [false, false, false, false, true, false, true]);
  assert.deepEqual(printedEntries(list).map(e => e.word), ['二十', '二', '十', '十一', '一']);
  list[6].again = true;
  assert.deepEqual(printedEntries(list).map(e => e.word), ['二十', '二', '十', '十一', '一', '十']);
});

test('Unsplit, Delete and the move buttons keep a word and its parts together', () => {
  const list = readText('1 | 你好 | nǐ hǎo\n> 你 | nǐ\n> 好 | hǎo\n1 | 他 | tā\n1 | 老师 | lǎoshī\n> 老 | lǎo\n> 师 | shī').entries;
  assert.deepEqual(show(unsplit(list, 0)).map(s => s.split(' ')[0]), ['你好', '他', '老师', '>老', '>师']);
  assert.deepEqual(show(deleteEntry(list, 0)).map(s => s.split(' ')[0]), ['他', '老师', '>老', '>师']);
  assert.deepEqual(show(moveEntry(list, 3, -1)).map(s => s.split(' ')[0]), ['他', '你好', '>你', '>好', '老师', '>老', '>师']);
  assert.deepEqual(show(moveEntry(list, 0, 1)).map(s => s.split(' ')[0]), ['他', '你好', '>你', '>好', '老师', '>老', '>师']);
  assert.deepEqual(show(moveEntry(list, 3, 1)).map(s => s.split(' ')[0]), ['你好', '>你', '>好', '老师', '>老', '>师', '他']);
  assert.equal(moveEntry(list, 0, -1), list);
  assert.equal(moveEntry(list, 4, 1), list);
});

test('the pinyin prompt lists what needs help; a word whose parts need help comes with all its parts', () => {
  const list = splitEntries([
    entry('国', 'guó', 'country'), entry('哪', 'nǎ'), entry('朋友', 'péngyou', 'friend'), entry('她', '', 'she'),
  ]).entries;
  assert.equal(pinyinPrompt('PROMPT\n', list), 'PROMPT\n哪\n朋友\n> 朋\n> 友\n她\n');
  assert.equal(pinyinPrompt('PROMPT', [entry('国', 'guó', 'country')]), '');
});

test('the reply to the pinyin prompt fills in each part place by place, and never overwrites', () => {
  const list = splitEntries([entry('朋友', 'péngyou', 'friend'), entry('哪', 'nǎ', 'which'), entry('有', 'yǒu')]).entries;
  const reply = readText('```\n朋友 | péngyou | friend\n> 朋 | péng | friend\n> 友 | yǒu → you | friend\n' +
    '哪 | nǎr | where\n有 | yǒu | to have\n山 | shān | mountain\n```').entries;
  assert.equal(allInList(list, reply), true);
  const result = fillIn(list, reply);
  assert.deepEqual(show(result.entries), ['朋友 péngyou', '>朋 péng', '>友 yǒu→you', '哪 nǎ', '有 yǒu']);
  assert.deepEqual(result.entries.map(e => e.meaning), ['friend', 'friend', 'friend', 'which', 'to have']);
  assert.ok(result.entries.every(e => !e.splitFrom));
  assert.equal(result.updated, 3);   // 朋, 友 and 有's meaning; 哪 keeps its own pinyin
  assert.equal(fillIn(result.entries, reply).updated, 0);
});

test('a flat reply (no "> " lines) fills in parts by their character', () => {
  const list = splitEntries([entry('女朋友', 'nǚ péngyou', 'girlfriend')]).entries;
  const reply = readText('女 | nǚ | woman\n朋 | péng | friend\n友 | yǒu | friend').entries;
  assert.equal(allInList(list, reply), true);
  const result = fillIn(list, reply);
  assert.equal(result.updated, 3);
  assert.deepEqual(result.entries.slice(1).map(e => `${e.word} ${e.pinyin} ${e.meaning}`), ['女 nǚ woman', '朋 péng friend', '友 yǒu friend']);
});

test('only useful lines decide between filling in and a new list', () => {
  const list = [entry('女', 'nǚ'), entry('国', 'guó', 'country')];
  assert.equal(allInList(list, readText('女 | nǚ | woman\n山 | shān | mountain\n朋友').entries), true);
  assert.equal(allInList(list, readText('女 | nǚ | woman\n她 | tā | she').entries), false);
  assert.equal(allInList(list, readText('女\n国').entries), false);
  assert.equal(allInList(list, []), false);
});

test('the pinyin prompt file uses the example the app knows, with characters not in the samples', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'prompts', 'pinyin-meaning.txt'), 'utf-8');
  const example = readText(prompt.slice(prompt.indexOf('FORMAT EXAMPLE')).split('\n').slice(1).join('\n')).entries;
  assert.deepEqual(example.map(e => e.word), PINYIN_PROMPT_EXAMPLE);
  const key = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'sample_key.txt'), 'utf-8');
  for (const word of PINYIN_PROMPT_EXAMPLE) assert.ok(![...word].some(ch => key.includes(ch)), word);
  assert.ok(prompt.trimEnd().endsWith('THE LIST:'));
});

test('isPinyinPromptExample: a reply with only the example lines', () => {
  const list = [entry('女')];
  const echo = readText('山 | shān | mountain\n水果 | shuǐguǒ | fruit\n> 水 | shuǐ → shuí | water\n> 果 | guǒ | fruit').entries;
  assert.equal(isPinyinPromptExample(echo, list), true);
  assert.equal(isPinyinPromptExample(echo, []), false);   // nothing to fill in: read it as a list
  assert.equal(isPinyinPromptExample([entry('女', 'nǚ', 'woman')], list), false);
  assert.equal(isPinyinPromptExample([entry('山', 'shān', 'mountain')], [entry('山')]), false);
});

// Found by the independent review of the parts change (each one was wrong before the fix).
test('Split takes a known meaning only for the same reading (行 háng in 银行 is not 行 xíng)', () => {
  const result = splitEntries([entry('银行', 'yínháng', 'bank'), entry('行', 'xíng', 'OK; to walk')], 0);
  const hang = result.entries[2];
  assert.deepEqual([hang.word, hang.pinyin, hang.meaning, hang.splitFrom], ['行', 'háng', '', '银行']);
});

test('filling in keeps the AI\'s "not sure" flag', () => {
  const list = splitEntries([entry('小雨', 'xiǎoyǔ', 'light rain')]).entries;
  const reply = readText('小雨 | xiǎoyǔ | light rain\n> 小 | xiǎo → xiáo | small ?\n> 雨 | yǔ | rain').entries;
  const result = fillIn(list, reply);
  assert.equal(result.entries[1].unsure, true);
  assert.equal(result.entries[2].unsure, false);
});

test('a word of the list that is also in the prompt\'s example is filled in like any other', () => {
  const list = splitEntries([entry('水果', 'shuǐguǒ'), entry('苹果', 'píngguǒ')]).entries;
  const reply = readText('水果 | shuǐguǒ | fruit\n> 水 | shuǐ → shuí | water\n> 果 | guǒ | fruit').entries;
  assert.equal(allInList(list, reply), true);
  const result = fillIn(list, reply);
  assert.deepEqual(result.entries.slice(0, 3).map(e => `${e.word} ${e.pinyin}${e.said ? '→' + e.said : ''} ${e.meaning}`),
    ['水果 shuǐguǒ fruit', '水 shuǐ→shuí water', '果 guǒ fruit']);
});

test('a reply without ">" marks still fills each character with its own word\'s reading', () => {
  const list = splitEntries([entry('一个', 'yí ge', 'one'), entry('一百', 'yìbǎi', 'one hundred')]).entries;
  const reply = readText('一个 | yí ge | one\n一 | yī → yí | one\n个 | gè → ge | (measure word)\n' +
    '一百 | yìbǎi | one hundred\n一 | yī → yì | one\n百 | bǎi | hundred').entries;
  const result = fillIn(list, reply);
  assert.deepEqual(show(result.entries), ['一个 yí ge', '>一 yī→yí', '>个 gè→ge', '一百 yìbǎi', '>一 yī→yì', '>百 bǎi']);
});
