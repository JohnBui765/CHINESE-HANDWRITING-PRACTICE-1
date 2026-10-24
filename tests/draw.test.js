// Tests for js/draw.js (run: node --test tests/draw.test.js)
// They build real PDFs into tests/output/ and check them with tools/check_pdf.py (PyMuPDF).
// The PyMuPDF checks are skipped when Python with PyMuPDF is not available; set the
// environment variable HANZI_PYTHON to choose the Python program.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { layoutSheet } from '../js/layout.js';
import { drawSheet } from '../js/draw.js';
import { layoutPractice } from '../js/practice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const fonts = {
  kai: fs.readFileSync(path.join(ROOT, 'fonts', 'ukai-cn.ttf')),
  print: fs.readFileSync(path.join(ROOT, 'fonts', 'noto-sans-sc.ttf')),
};

const PYTHON = process.env.HANZI_PYTHON || 'python3';
function pythonWorks() {
  try {
    execFileSync(PYTHON, ['-c', 'import pymupdf'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAVE_PYMUPDF = pythonWorks();
const check = (...args) => JSON.parse(execFileSync(PYTHON, [path.join(ROOT, 'tools', 'check_pdf.py'), ...args], { encoding: 'utf-8' }));

const WORDS = [
  { word: '女朋友', pinyin: 'nǚ péngyou', meaning: 'girlfriend', rows: 'Page' },
  { word: '哪', pinyin: 'nǎ', meaning: 'which', rows: 6 },
  { word: '国', pinyin: 'guó', meaning: 'country, nation', rows: 6 },
  { word: '工作', pinyin: '', meaning: '', rows: 3 },
];

async function build(boxSize, name, options, withoutTexts = false) {
  const layout = layoutSheet(WORDS, boxSize);
  if (withoutTexts) for (const page of layout.pages) page.texts = [];
  const bytes = await drawSheet(layout, fonts, 'Test list', options);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

test('builds a PDF for both box sizes', async () => {
  for (const size of ['small', 'large']) {
    const { bytes } = await build(size, `draw-${size}.pdf`);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
    assert.ok(bytes.length < 200_000, `${size}: the PDF stays small (${bytes.length} bytes)`);
  }
});

test('both fonts are embedded as subsets, the title is set, the text can be read', { skip: !HAVE_PYMUPDF && 'PyMuPDF not available' }, async () => {
  for (const size of ['small', 'large']) {
    const { file } = await build(size, `draw-${size}.pdf`);
    const info = check(file, '--json');
    const names = info.fonts.map(f => f.name.split('+').pop());
    assert.ok(names.some(n => n.startsWith('UKaiCN')), `${size}: UKai embedded (${names})`);
    assert.ok(names.some(n => n.startsWith('NotoSansSC')), `${size}: Noto Sans SC embedded (${names})`);
    for (const f of info.fonts) {
      assert.ok(f.embedded, `${f.name} embedded`);
      assert.ok(f.bytes < 100_000, `${f.name} is a subset (${f.bytes} bytes)`);
    }
    assert.equal(info.title, 'Test list');
    const text = info.text.join('\n');
    for (const w of WORDS) assert.ok(text.includes(w.word[0]), `${size}: text contains ${w.word}`);
    if (size === 'large') assert.ok(text.includes('nǚ péngyou'), 'pinyin label is readable text');
    else assert.ok(text.includes('1/2') || text.includes('1/1'), 'page number');
  }
});

// The header and label text are left out of this comparison: with whole fonts pdf-lib spaces
// some Latin punctuation differently (the reference is what differs, not the app's output).
test('subsetting changes no character: same pixels as the fonts embedded whole', { skip: !HAVE_PYMUPDF && 'PyMuPDF not available' }, async () => {
  for (const size of ['small', 'large']) {
    const a = await build(size, `draw-${size}-chars.pdf`, {}, true);
    const b = await build(size, `draw-${size}-full-fonts.pdf`, { subsetFonts: false }, true);
    const result = check(a.file, '--compare', b.file);
    assert.ok(result.same_page_count);
    assert.deepEqual(result.differing_pixels_per_page, result.differing_pixels_per_page.map(() => 0), size);
  }
});

test('builds a practice PDF in every box size with both fonts embedded', { skip: !HAVE_PYMUPDF && 'PyMuPDF not available' }, async () => {
  const items = [...WORDS, { word: '哥哥', pinyin: 'gēge', meaning: 'older brother', rows: 3 }];
  for (const box of [14, 12, 10]) {
    const layout = layoutPractice(items, { box, rounds: 3, seed: 4, name: 'Bài 3–4' });
    const bytes = await drawSheet(layout, fonts, 'Bài 3–4');
    const file = path.join(OUT, `practice-${box}.pdf`);
    fs.writeFileSync(file, bytes);
    const info = check(file, '--json');
    assert.equal(info.pages, layout.pages.length);
    const names = info.fonts.map(f => f.name);
    assert.ok(names.some(n => n.includes('UKaiCN')) && names.some(n => n.includes('NotoSansSC')), names.join(','));
    assert.ok(info.fonts.every(f => f.embedded && f.bytes < 100_000));
    const text = info.text.join('\n');
    for (const heading of ['PART 1: MODEL LIST', 'PART 2: SIDE B ONLY', 'PART 3: MIXED PRACTICE (15)', 'Round 3', 'nǚ péngyou', '- girlfriend']) {
      assert.ok(text.includes(heading), `${box} mm: ${heading}`);
    }
  }
});
