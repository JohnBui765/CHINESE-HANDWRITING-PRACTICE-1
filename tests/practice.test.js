// Tests for js/practice.js (run: node --test tests/practice.test.js)
// The numbers come from the owner's sample HSK1_Bai3-4_practice_kai.pdf (14 mm boxes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPractice, practiceRounds, maxPracticeChars, wideLineChars } from '../js/practice.js';
import { MM, PAGE_HEIGHT } from '../js/layout.js';

// The 30 words of the sample (Bài 3–4).
const WORDS = '女朋友 哪 国 她 喂 姐姐 工作 还 忙 吗 对 太 想 中国 法国 中文 越南 泰国 有 多少 个 哥哥 呢 没有 家 口 爸爸 妈妈 妹妹 和'.split(' ');
const ITEMS = WORDS.map((word, i) => ({ word, pinyin: `p${i}`, meaning: `m${i}` }));

const fromTop = y => Math.round((PAGE_HEIGHT - y) / MM * 100) / 100;
const textsOn = (page, pattern) => page.texts.filter(t => pattern.test(t.text));

test('the 30 sample words make 13 pages with the same rows per page as the sample', () => {
  const { pages } = layoutPractice(ITEMS, { box: 14, rounds: 3, seed: 7 });
  const numbersPerPage = pages.map(p => textsOn(p, /^\d+\.$/).length);
  assert.deepEqual(numbersPerPage, [14, 15, 1, 14, 15, 1, 13, 15, 14, 15, 14, 15, 4]);
});

test('positions match the sample (14 mm boxes)', () => {
  const { pages } = layoutPractice(ITEMS, { box: 14, rounds: 3, seed: 7, name: 'Bài 3–4' });
  const titleOf = p => p.texts[0];
  // Part 1: title at 24 mm, first box at 30.5 mm, then every 17 mm.
  assert.equal(titleOf(pages[0]).text, 'PART 1: MODEL LIST (Side A: Side B)');
  assert.equal(fromTop(titleOf(pages[0]).y), 24);
  const numbers = textsOn(pages[0], /^\d+\.$/);
  assert.deepEqual(numbers.slice(0, 3).map(t => fromTop(t.y)), [39, 56, 73]);   // box top + 8.5
  assert.ok(numbers.every(t => t.align === 'right' && Math.abs(t.x / MM - 23) < 0.01));
  const pinyin = pages[0].texts.find(t => t.text === 'p0');
  const meaning = pages[0].texts.find(t => t.text === '- m0');
  assert.equal(fromTop(pinyin.y), 38.5);
  assert.equal(Math.round(pinyin.x / MM * 10) / 10, 73);
  assert.equal(Math.round(meaning.x / MM * 10) / 10, 103);
  assert.equal(pinyin.size, 13);
  assert.equal(meaning.size, 10.5);
  // The list name sits on the title line, on the right.
  assert.ok(pages[0].texts.some(t => t.text === 'Bài 3–4' && t.align === 'right'));
  // Part 2 starts a new page; subtitle at 30 mm; first box at 36.5 mm; boxes are empty.
  assert.equal(titleOf(pages[3]).text, 'PART 2: SIDE B ONLY');
  assert.equal(fromTop(textsOn(pages[3], /^Write the character/)[0].y), 30);
  assert.equal(fromTop(textsOn(pages[3], /^1\.$/)[0].y), 36.5 + 8.5);
  assert.equal(pages[3].chars.length, 0);
  // Part 3: title, subtitle, "Round 1" at 41 mm, first box at 47.5 mm.
  assert.equal(titleOf(pages[6]).text, 'PART 3: MIXED PRACTICE (90)');
  assert.equal(fromTop(textsOn(pages[6], /^Round 1$/)[0].y), 41);
  assert.equal(fromTop(textsOn(pages[6], /^1\.$/)[0].y), 47.5 + 8.5);
  // Answer lines: 12 mm below the box top, from x = 73 mm to 195 mm.
  const line = pages[6].marks.find(m => m.kind === 'answer');
  assert.equal(Math.round(line.x2 / MM), 195);
  // "Round 2" in the middle of page 9: 7.5 mm below the box above, the next box 6.5 mm lower.
  const round2 = textsOn(pages[8], /^Round 2$/)[0];
  const above = textsOn(pages[8], /^30\.$/)[0];
  const below = textsOn(pages[8], /^31\.$/)[0];
  assert.equal(fromTop(round2.y), fromTop(above.y) - 8.5 + 14 + 7.5);
  assert.equal(fromTop(below.y), fromTop(round2.y) + 6.5 + 8.5);
});

test('no box goes below 271.5 mm, for every box size', () => {
  for (const box of [14, 12, 10]) {
    const { pages } = layoutPractice(ITEMS, { box, rounds: 3, seed: 3 });
    for (const page of pages) {
      for (const l of page.grid) assert.ok(fromTop(Math.min(l.y1, l.y2)) <= 271.5 + 1e-6, `${box} mm`);
    }
  }
});

test('smaller boxes fit more rows and need fewer pages', () => {
  const pages = [14, 12, 10].map(box => layoutPractice(ITEMS, { box, rounds: 3, seed: 3 }).pages.length);
  assert.equal(pages[0], 13);
  assert.ok(pages[1] < pages[0] && pages[2] < pages[1], pages.join(', '));
});

test('every round has every word once, half shown as the word, half as side B', () => {
  const rounds = practiceRounds(ITEMS, 3, 11);
  assert.equal(rounds.length, 3);
  for (const round of rounds) {
    assert.deepEqual(round.map(r => r.index).sort((a, b) => a - b), ITEMS.map((_, i) => i));
    assert.equal(round.filter(r => r.show === 'word').length, 15);
  }
  // Round 2 swaps round 1: every word is practised both ways.
  const show = (r, i) => rounds[r].find(x => x.index === i).show;
  for (let i = 0; i < ITEMS.length; i++) assert.notEqual(show(0, i), show(1, i));
  // A round never starts with the word that ended the round before.
  for (let r = 1; r < rounds.length; r++) assert.notEqual(rounds[r][0].index, rounds[r - 1].at(-1).index);
});

test('the same seed gives the same sheet, another seed a new order', () => {
  const a = JSON.stringify(practiceRounds(ITEMS, 3, 5));
  assert.equal(a, JSON.stringify(practiceRounds(ITEMS, 3, 5)));
  assert.notEqual(a, JSON.stringify(practiceRounds(ITEMS, 3, 6)));
});

test('words without pinyin or meaning still print; with neither, Part 3 always shows the word', () => {
  const items = [
    { word: '女朋友', pinyin: 'nǚ péngyou', meaning: 'girlfriend' },
    { word: '哪', pinyin: '', meaning: 'which' },
    { word: '国', pinyin: 'guó', meaning: '' },
    { word: '她', pinyin: '', meaning: '' },
  ];
  const { pages } = layoutPractice(items, { box: 14, rounds: 3, seed: 2 });
  assert.ok(pages.length > 0);
  for (const round of practiceRounds(items, 3, 2)) {
    assert.equal(round.find(r => r.index === 3).show, 'word');
  }
  const all = pages.flatMap(p => p.texts.map(t => t.text));
  assert.ok(all.includes('- which') && all.includes('guó'));
  assert.ok(!all.includes('- '), 'no empty meaning dash');
});

test('long words move pinyin to the right; longer ones get a wide row', () => {
  const { pages } = layoutPractice([{ word: '很高兴认识', pinyin: 'hěn gāoxìng rènshi', meaning: 'nice to meet you' }], { box: 14, rounds: 1, seed: 1 });
  const pinyin = pages[0].texts.find(t => t.text.startsWith('hěn'));
  assert.equal(Math.round(pinyin.x / MM), 25 + 5 * 14 + 6);
  assert.equal(maxPracticeChars(14), 6);
  assert.equal(wideLineChars(14), 12);

  // A sentence of 15 boxes: 12 on the first line, 3 on the second, then pinyin and meaning
  // under the boxes, from x = 25 mm.
  const sentence = { word: '你好！我叫李小雨。我买一本书。', pinyin: 'Ní hǎo! Wǒ jiào Lǐ Xiáoyǔ. Wó mǎi yì běn shū.', meaning: 'Hello! ...' };
  const wide = layoutPractice([sentence], { box: 14, rounds: 1, seed: 2 });
  const part1 = wide.pages[0];
  assert.equal(part1.chars.length, 15);
  const fromTop = y => (PAGE_HEIGHT - y) / MM;
  assert.equal(Math.round(part1.chars[12].cx), Math.round(part1.chars[0].cx));
  assert.equal(Math.round(fromTop(part1.chars[12].cy) - fromTop(part1.chars[0].cy)), 14);
  const py = part1.texts.find(t => t.text === sentence.pinyin);
  assert.equal(Math.round(py.x / MM), 25);
  assert.equal(Math.round(fromTop(py.y) * 10) / 10, 30.5 + 2 * 14 + 5.5);
  // Part 3: the sentence with two answer lines, or empty boxes with side B.
  const part3 = wide.pages[2];
  const answers = part3.marks.filter(m => m.kind === 'answer').length;
  assert.ok((answers === 2 && part3.chars.length === 15) || (answers === 0 && part3.chars.length === 0));
  assert.throws(() => layoutPractice([{ word: '一'.repeat(300), pinyin: '', meaning: '' }], { box: 14 }), /too long for one page/);
});

test('rounds and box size are kept within their limits', () => {
  assert.match(layoutPractice(ITEMS.slice(0, 2), { rounds: 9 }).pages[2].texts[0].text, /\(10\)$/);   // 5 rounds x 2
  assert.match(layoutPractice(ITEMS.slice(0, 2), { rounds: 0 }).pages[2].texts[0].text, /\(6\)$/);    // default 3
  assert.equal(layoutPractice([], {}).pages.length, 0);
});

// Found by the independent review: a round heading must have its first row on the same page.
test('a round heading is never left alone at the bottom of a page', () => {
  const sentence = n => ({ word: '你'.repeat(n - 1) + '。', pinyin: 'nǐ', meaning: 'you' });
  const word = w => ({ word: w, pinyin: 'nǐ', meaning: 'you' });
  for (let seed = 1; seed <= 60; seed++) {
    const items = [sentence(15), word('你'), word('你好'), word('你'), sentence(19), word('你好'), word('你'), word('你好')];
    const { pages } = layoutPractice(items, { box: 14, rounds: 3, seed });
    for (const page of pages) {
      const last = page.texts[page.texts.length - 1];
      assert.ok(!/^Round \d+$/.test(last.text), `seed ${seed}: "${last.text}" ends a page`);
    }
  }
});
