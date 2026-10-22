// Browser tests for js/readers.js: every test file goes through readFile in Chromium.
// Run with:  node --test tests/browser/readers.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PRACTICE_PDF = 'samples/Chinese character practice.pdf';
const LIAO_PDF = 'samples/Luyện viết HSK1 - (Part 3).pdf';
const missing = file => !fs.existsSync(path.join(ROOT, file)) && `${file} is missing`;

let server;
let browser;
let page;
const pageErrors = [];

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(server.address + 'tests/browser/readers.html');
  await page.waitForFunction(() => window.testReady === true);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

// Fetches a project file in the page, makes a File from its bytes and calls readFile.
// Returns { picture } or { text, name, list } (list = readText's result), or { error }.
async function readInBrowser(file, fileName = path.basename(file), type = '') {
  const url = server.address + file.split('/').map(encodeURIComponent).join('/');
  return page.evaluate(
    async ({ url, fileName, type }) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`could not fetch ${url}`);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type });
      try {
        const result = await window.readers.readFile(file);
        if (result.picture) return result;
        return { ...result, list: window.extract.readText(result.text, result.name) };
      } catch (error) {
        return { error: error.message };
      }
    },
    { url, fileName, type },
  );
}

const words = result => {
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.picture, undefined, 'read as a picture');
  return result.list.entries.map(e => e.word);
};

// ---- .txt ----------------------------------------------------------------------------------

test('lesson .txt with pinyin and meaning columns', async () => {
  const result = await readInBrowser('tests/fixtures/lesson_columns.txt');
  assert.deepEqual(words(result), ['女朋友', '哪', '国', '她', '喂']);
  assert.equal(result.name, 'lesson_columns');
  assert.equal(result.list.name, 'Bài 5');
  assert.equal(result.list.removed, 1);
  assert.equal(result.list.entries[0].pinyin, 'nǚ péngyou');
  assert.equal(result.list.entries[0].meaning, 'girlfriend');
});

test('lesson .txt without columns', async () => {
  const result = await readInBrowser('tests/fixtures/lesson_plain.txt');
  assert.deepEqual(words(result), ['女朋友', '哪', '国']);
  assert.equal(result.list.name, 'Bài 5');
});

test('.txt in UTF-16 and in GB18030', async () => {
  for (const file of ['lesson_utf16.txt', 'lesson_gb18030.txt']) {
    const result = await readInBrowser('tests/fixtures/' + file);
    assert.deepEqual(words(result), ['你好', '谢谢'], file);
    assert.equal(result.list.name, '第三课', file);
    assert.equal(result.list.entries[0].pinyin, 'nǐ hǎo', file);
  }
});

// ---- .docx ---------------------------------------------------------------------------------

test('.docx paragraphs (a word split over two runs, mixed text, a repeat)', async () => {
  const result = await readInBrowser('tests/fixtures/docx_paragraphs.docx');
  assert.deepEqual(words(result), ['女朋友', '哪', '国']);
  assert.equal(result.list.name, 'Bài 7');
  assert.equal(result.list.removed, 1);
});

test('.docx table with a nested table', async () => {
  const result = await readInBrowser('tests/fixtures/docx_table.docx');
  assert.deepEqual(words(result), ['她', '喂', '姐姐', '工作', '还', '忙']);
  assert.equal(result.name, 'docx_table');
  assert.equal(result.list.name, 'docx_table');
});

test('.docx text box (its text is in the file twice)', async () => {
  const result = await readInBrowser('tests/fixtures/docx_textbox.docx');
  assert.deepEqual(words(result), ['太', '吗', '对']);
  assert.equal(result.list.removed, 1);
});

test('.docx Shift+Enter, carriage return and tab; tab stops are not tabs', async () => {
  const result = await readInBrowser('tests/fixtures/docx_breaks.docx');
  assert.deepEqual(words(result), ['国', '中国', '哪', '那里', '法国', '越南']);
  assert.equal(result.text, '国\n中国\n哪\t那里\n法国\n越南');
});

test('.docx content controls, a hyperlink and a field code', async () => {
  const result = await readInBrowser('tests/fixtures/docx_controls.docx');
  assert.deepEqual(words(result), ['想', '我', '有', '泰国', '中文']);
  assert.equal(result.text.includes('错误'), false, 'field code text must not be read');
});

test('.docx tracked changes: deleted text is left out', async () => {
  const result = await readInBrowser('tests/fixtures/docx_deleted.docx');
  assert.deepEqual(words(result), ['爸爸', '妈妈', '妹妹']);
  assert.equal(result.text.includes('错字'), false);
});

test('.docx with only a picture', async () => {
  assert.deepEqual(await readInBrowser('tests/fixtures/docx_picture.docx'), { picture: true });
});

test('docxText gives one line per paragraph', async () => {
  const text = await page.evaluate(async url => {
    const bytes = await (await fetch(url)).arrayBuffer();
    return window.readers.docxText(bytes);
  }, server.address + 'tests/fixtures/docx_table.docx');
  assert.equal(text, '她\n喂\n姐姐\n工作\n还\n忙');
});

// ---- .pdf ----------------------------------------------------------------------------------

test('text-layer PDF: pieces are put in reading order', async () => {
  const result = await readInBrowser('tests/fixtures/text_layer.pdf');
  assert.equal(result.text, '你好 ni hao 再见\n朋友 谢谢\n中文\n汉字\n第二页\n你好');
  assert.deepEqual(words(result), ['你好', '再见', '朋友', '谢谢', '中文', '汉字', '第二页']);
  assert.equal(result.list.removed, 1);
  assert.equal(result.list.name, 'text_layer');
});

test('PDF words drawn with letter spacing: under 0.3 × the font size they stay one word', async () => {
  const result = await readInBrowser('tests/fixtures/letter_spacing.pdf');
  assert.equal(result.text, '女朋友\n哪 国 她');
  assert.deepEqual(words(result), ['女朋友', '哪', '国', '她']);
});

test('PDF with Kangxi radical code points gives normal characters', async () => {
  const result = await readInBrowser('tests/fixtures/kangxi.pdf');
  assert.deepEqual(words(result), ['女朋友', '人', '口', '月亮']);
  assert.equal(result.list.entries[0].word.codePointAt(0), 0x5973);
});

test('picture-only PDF', async () => {
  assert.deepEqual(await readInBrowser('tests/fixtures/picture.pdf'), { picture: true });
});

test('samples/Chinese character practice.pdf gives the 10 words', { skip: missing(PRACTICE_PDF) }, async () => {
  const result = await readInBrowser(PRACTICE_PDF);
  assert.deepEqual(words(result), ['女朋友', '哪', '国', '她', '喂', '姐姐', '工作', '还', '忙', '吗']);
  assert.equal(result.list.removed, 20);
  assert.equal(result.list.name, 'Chinese character practice');
});

test('the Liao Laoshi worksheet is a picture-only PDF', { skip: missing(LIAO_PDF) }, async () => {
  assert.deepEqual(await readInBrowser(LIAO_PDF), { picture: true });
});

// ---- pictures and other files --------------------------------------------------------------

test('a PNG and a JPEG photo are pictures', async () => {
  assert.deepEqual(await readInBrowser('tests/fixtures/picture.png'), { picture: true });
  assert.deepEqual(await readInBrowser('tests/fixtures/photo.jpg', 'IMG_0001.JPG'), { picture: true });
  // An iPhone photo without a known extension is recognised by its type.
  assert.deepEqual(await readInBrowser('tests/fixtures/photo.jpg', 'image', 'image/jpeg'), {
    picture: true,
  });
});

test('an unknown kind of file gives a plain-English error', async () => {
  const result = await readInBrowser('tests/fixtures/lesson_plain.txt', 'words.xlsx');
  assert.match(result.error, /can't open "words\.xlsx"/);
  const old = await readInBrowser('tests/fixtures/lesson_plain.txt', 'old.doc');
  assert.match(old.error, /save it as \.docx/);
});

test('a damaged .docx or .pdf gives a plain-English error', async () => {
  const docx = await readInBrowser('tests/fixtures/lesson_plain.txt', 'broken.docx');
  assert.match(docx.error, /could not be opened/);
  const pdf = await readInBrowser('tests/fixtures/lesson_plain.txt', 'broken.pdf');
  assert.match(pdf.error, /could not be opened/);
});

test('no errors on the page', () => {
  assert.deepEqual(pageErrors, []);
});
