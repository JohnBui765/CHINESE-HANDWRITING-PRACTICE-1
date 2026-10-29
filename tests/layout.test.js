// Tests for js/layout.js (run: node --test tests/layout.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSheet, emptyRows, labelText, MM, PAGE_HEIGHT, HEADER_TEXT } from '../js/layout.js';

const item = (word, rows, pinyin = '', meaning = '') => ({ word, pinyin, meaning, rows });
const mmFromTop = y => (PAGE_HEIGHT - y) / MM;
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} != ${b}`);

test('rows per block: 2 + N for N = 0, 1, 3, 6 and Page, both box sizes', () => {
  for (const [size, page] of [['small', 26], ['large', 17]]) {
    const layout = layoutSheet([0, 1, 3, 6, 'Page'].map(n => item('哪', n)), size);
    assert.deepEqual(layout.blocks.map(b => b.rows), [2, 3, 5, 8, page], size);
  }
});

test('Page stays a whole page and big numbers are lowered to the maximum', () => {
  assert.equal(emptyRows('Page', 'small'), 24);
  assert.equal(emptyRows('Page', 'large'), 15);
  assert.equal(emptyRows(20, 'large'), 15);
  assert.equal(emptyRows(20, 'small'), 20);
  assert.equal(emptyRows(-3, 'small'), 0);
});

test('small boxes: blocks never split, Page starts a new page and fills it', () => {
  const items = [item('女朋友', 6), item('哪', 6), item('国', 6), item('她', 'Page'), item('还', 3)];
  const { blocks, pages } = layoutSheet(items, 'small');
  for (const b of blocks) assert.ok(b.row + b.rows <= 26, 'block fits on its page');
  // 8 + 8 + 8 = 24 rows on page 1; the Page block (26 rows) needs page 2; 还 goes to page 3.
  assert.deepEqual(blocks.map(b => [b.page, b.row]), [[0, 0], [0, 8], [0, 16], [1, 0], [2, 0]]);
  assert.equal(pages.length, 3);
  // Every page has the full 18 x 26 grid: 27 horizontal + 19 vertical lines.
  for (const p of pages) assert.equal(p.grid.length, 27 + 19);
});

test('small boxes: geometry from reference/make_grid.py', () => {
  const { pages } = layoutSheet([item('女朋友', 3)], 'small');
  const p = pages[0];
  const top = p.grid[0];
  near(top.x1 / MM, 15, 'left margin');
  near(top.x2 / MM, 195, 'grid right');
  near(mmFromTop(top.y1), 20, 'grid top');
  // KaiTi row first, print row directly below, characters centred in cells 1..3.
  const kai = p.chars.filter(c => c.font === 'kai');
  const print = p.chars.filter(c => c.font === 'print');
  assert.deepEqual(kai.map(c => c.ch).join(''), '女朋友');
  kai.forEach((c, i) => near(c.cx / MM, 15 + 10 * i + 5, `kai x ${i}`));
  near(mmFromTop(kai[0].cy), 25, 'kai row centre');
  near(mmFromTop(print[0].cy), 35, 'print row centre');
  // The block line runs along the top edge of the block.
  assert.equal(p.marks.length, 1);
  near(mmFromTop(p.marks[0].y1), 20, 'block line');
  // Header: left text and page/total, 13 mm from the top.
  assert.equal(p.texts[0].text, HEADER_TEXT);
  assert.equal(p.texts[1].text, '1/1');
  near(mmFromTop(p.texts[0].y), 13, 'header');
});

test('small boxes: page numbers know the total', () => {
  const { pages } = layoutSheet([item('哪', 'Page'), item('国', 'Page'), item('她', 'Page')], 'small');
  assert.deepEqual(pages.map(p => p.texts[1].text), ['1/3', '2/3', '3/3']);
});

test('large boxes: measurements match samples/Chinese character practice.pdf', () => {
  // Page 2 of the sample: 哪 (2 + 6 rows) and 国 (2 + 6 rows) share a page.
  const { pages, blocks } = layoutSheet([item('哪', 6, 'nǎ', 'which'), item('国', 6, 'guó', 'country, nation')], 'large');
  assert.equal(pages.length, 1);
  assert.deepEqual(blocks.map(b => b.gridTopMm), [22, 158.5]);
  const p = pages[0];
  const labels = p.texts.map(t => [t.text, Math.round(mmFromTop(t.y) * 100) / 100]);
  assert.deepEqual(labels, [['哪   nǎ   - which', 19], ['国   guó   - country, nation', 155.5]]);
  assert.equal(p.marks.length, 1);
  assert.equal(p.marks[0].kind, 'cut');
  near(mmFromTop(p.marks[0].y1), 148.5, 'cut line');
  near(p.marks[0].x1 / MM, 15, 'cut line start');
  near(p.marks[0].x2 / MM, 195, 'cut line end');
  // Lowest grid bottom: 158.5 + 8 x 15 = 278.5 mm.
  const bottoms = p.grid.filter(l => l.y1 === l.y2).map(l => mmFromTop(l.y1));
  near(Math.max(...bottoms), 278.5, 'lowest grid line');
  // Cells: 15 mm, 12 columns from x = 15 to 195 mm.
  const verticals = [...new Set(p.grid.filter(l => l.x1 === l.x2).map(l => Math.round(l.x1 / MM * 10) / 10))];
  assert.deepEqual(verticals, [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195]);
  // Dashed cross in every cell: 2 lines x 12 columns x 16 rows.
  assert.equal(p.crosses.length, 2 * 12 * 16);
});

test('large boxes: a Page block fills a page (17 rows) and the next word starts a new page', () => {
  const { pages, blocks } = layoutSheet([item('女朋友', 'Page'), item('哪', 6), item('国', 6), item('她', 6)], 'large');
  assert.deepEqual(blocks.map(b => [b.page, b.gridTopMm, b.rows]),
    [[0, 22, 17], [1, 22, 8], [1, 158.5, 8], [2, 22, 8]]);
  assert.equal(pages.length, 3);
  near(22 + 17 * 15, 277, 'Page block bottom');
});

test('large boxes: labels leave out unknown parts', () => {
  assert.equal(labelText(item('国', 1, 'guó', 'country')), '国   guó   - country');
  assert.equal(labelText(item('国', 1, 'guó', '')), '国   guó');
  assert.equal(labelText(item('国', 1, '', 'country')), '国   - country');
  assert.equal(labelText(item('国', 1)), '国');
});

test('a long sentence carries on to the next line: KaiTi row, print row, KaiTi row, print row', () => {
  const sentence = '你好！我叫李小雨。我是中国人。我买一本书。';   // 21 boxes, punctuation included
  for (const [size, columns, box] of [['small', 18, 10], ['large', 12, 15]]) {
    const layout = layoutSheet([item(sentence, 3, 'Nǐ hǎo!', 'Hello!')], size);
    assert.deepEqual(layout.blocks.map(b => b.rows), [2 * 2 + 3], size);
    // The KaiTi row is every other one of the characters (KaiTi, print, KaiTi, print, ...).
    const kai = layout.pages[0].chars.filter((_, i) => i % 2 === 0);
    const print = layout.pages[0].chars.filter((_, i) => i % 2 === 1);
    assert.equal(kai.length, 21);
    // Punctuation in the KaiTi row comes from the print font (mainland position).
    assert.deepEqual([kai[1].font, kai[2].font], ['kai', 'print']);
    // The first character after a full line starts the next KaiTi row, two rows lower.
    near(kai[columns].cx, kai[0].cx, `${size} x`);
    near(kai[0].cy - kai[columns].cy, 2 * box * MM, `${size} y`);
    near(kai[0].cy - print[0].cy, box * MM, `${size} print row`);
    // Punctuation gets its own box.
    assert.equal(kai[2].ch, '！');
  }
  // A sentence label leaves out the sentence (it is in the boxes).
  assert.equal(labelText(item(sentence, 1, 'Nǐ hǎo!', 'Hello!')), 'Nǐ hǎo!   - Hello!');
  // "Page" fills the rest of the page; a sentence too long for one page is refused.
  assert.deepEqual(layoutSheet([item(sentence, 'Page')], 'small').blocks.map(b => b.rows), [26]);
  assert.equal(emptyRows('Page', 'large', 2), 13);
  assert.throws(() => layoutSheet([item('一'.repeat(97), 0)], 'large'), /too long for one page/);
  assert.doesNotThrow(() => layoutSheet([item('一'.repeat(96), 0)], 'large'));
  assert.throws(() => layoutSheet([item('一'.repeat(235), 0)], 'small'), /too long for one page/);
});

test('an empty list makes no pages', () => {
  assert.equal(layoutSheet([], 'small').pages.length, 0);
  assert.equal(layoutSheet([], 'large').pages.length, 0);
});
