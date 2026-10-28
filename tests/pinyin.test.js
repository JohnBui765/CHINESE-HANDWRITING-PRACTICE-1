// Tests for js/pinyin.js (run: node --test tests/pinyin.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPinyin, SYLLABLES } from '../js/pinyin.js';

const split = (pinyin, word) => splitPinyin(pinyin, word);

test('the syllable table has the about 400 standard syllables', () => {
  assert.ok(SYLLABLES.size > 400 && SYLLABLES.size < 420, String(SYLLABLES.size));
  for (const s of ['zhuang', 'nv', 'lve', 'er', 'shei', 'jiong']) assert.ok(SYLLABLES.has(s), s);
  for (const s of ['zhv', 'bv', 'jv', 'r', 'n']) assert.ok(!SYLLABLES.has(s), s);
});

test('words written with spaces, without spaces, with capitals', () => {
  assert.deepEqual(split('nǚ péngyou', '女朋友'), ['nǚ', 'péng', 'you']);
  assert.deepEqual(split('nǚ péng you', '女朋友'), ['nǚ', 'péng', 'you']);
  assert.deepEqual(split('nǚpéngyou', '女朋友'), ['nǚ', 'péng', 'you']);
  assert.deepEqual(split('Zhōngguó', '中国'), ['zhōng', 'guó']);
  assert.deepEqual(split('Fǎguó', '法国'), ['fǎ', 'guó']);
  assert.deepEqual(split('jiějie', '姐姐'), ['jiě', 'jie']);
  assert.deepEqual(split('duōshao', '多少'), ['duō', 'shao']);
  assert.deepEqual(split('méi guānxi', '没关系'), ['méi', 'guān', 'xi']);
  assert.deepEqual(split('zěnmeyàng', '怎么样'), ['zěn', 'me', 'yàng']);
  assert.deepEqual(split('xiànzài', '现在'), ['xiàn', 'zài']);
  assert.deepEqual(split('chūzūchē', '出租车'), ['chū', 'zū', 'chē']);
});

test('apostrophes, hyphens and syllables that start with a vowel', () => {
  assert.deepEqual(split("Xī'ān", '西安'), ['xī', 'ān']);
  assert.deepEqual(split("Tiān'ānmén", '天安门'), ['tiān', 'ān', 'mén']);
  assert.deepEqual(split("nǚ'ér", '女儿'), ['nǚ', 'ér']);
  assert.deepEqual(split('méiwán-méiliǎo', '没完没了'), ['méi', 'wán', 'méi', 'liǎo']);
  // Without the apostrophe, a syllable starting with a, o or e is accepted in the middle
  // only when it has its own tone mark.
  assert.deepEqual(split('Xīān', '西安'), ['xī', 'ān']);
  assert.deepEqual(split('nǚér', '女儿'), ['nǚ', 'ér']);
  assert.equal(split('xian', '西安'), null);
});

test('ü written as ü, v or with tone numbers', () => {
  assert.deepEqual(split('lǜsè', '绿色'), ['lǜ', 'sè']);
  assert.deepEqual(split('lv4se4', '绿色'), ['lv4', 'se4']);
  assert.deepEqual(split('ni3hao3', '你好'), ['ni3', 'hao3']);
  assert.deepEqual(split('Hànyǔ', '汉语'), ['hàn', 'yǔ']);
});

test('words ending in 儿 written with one syllable less', () => {
  assert.deepEqual(split('nǎr', '哪儿'), ['nǎ', 'ér']);
  assert.deepEqual(split('nǎ r', '哪儿'), ['nǎ', 'ér']);
  assert.deepEqual(split('yìdiǎnr', '一点儿'), ['yì', 'diǎn', 'ér']);
  assert.deepEqual(split('yíhuìr', '一会儿'), ['yí', 'huì', 'ér']);
  assert.deepEqual(split('zhèr', '这儿'), ['zhè', 'ér']);
  assert.deepEqual(split('érzi', '儿子'), ['ér', 'zi']);
});

test('pinyin that does not fit the word is not split', () => {
  assert.equal(split('hǎo', '你好'), null);         // one syllable for two characters
  assert.equal(split('nǐ hǎo ma', '你好'), null);   // three syllables for two characters
  assert.equal(split('', '你好'), null);
  assert.equal(split('hello', '你好'), null);
  assert.equal(split('nǐ hǎo', ''), null);
});

// Found by the independent review (each one was wrong before the fix).
test('a missing syllable gives null, not a shifted split', () => {
  assert.equal(split('Zhōngguó', '中国人'), null);
  assert.equal(split('yìdiǎn', '一点儿'), null);
  assert.equal(split('yíkuài', '一块儿'), null);
});

test('儿 words written with an untoned "er" or a toned final syllable', () => {
  assert.deepEqual(split('yuèr', '月儿'), ['yuè', 'ér']);
  assert.deepEqual(split('nǚer', '女儿'), ['nǚ', 'er']);
  assert.deepEqual(split('yúer', '鱼儿'), ['yú', 'er']);
  assert.deepEqual(split('nar3', '哪儿'), ['na3', 'ér']);   // the tone number stays with "na"
});

test('"u:" for ü, full-width letters, and a syllable with two tone marks', () => {
  assert.deepEqual(split('nu:3 er2', '女儿'), ['nu:3', 'er2']);
  assert.deepEqual(split('lu:4 se4', '绿色'), ['lu:4', 'se4']);
  assert.deepEqual(split('ｚhōngguó', '中国'), ['zhōng', 'guó']);
  assert.equal(split('Xīānshì', '西安'), null);
});

test('odd input never freezes the app', () => {
  const start = performance.now();
  assert.equal(split('xiān'.repeat(28) + 'q', '一'.repeat(29)), null);
  assert.equal(split('a'.repeat(40000), '一'.repeat(10)), null);
  assert.ok(performance.now() - start < 1000, `${Math.round(performance.now() - start)} ms`);
});
