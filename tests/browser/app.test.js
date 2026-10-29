// Whole-app tests in Chromium (run: node --test tests/browser/app.test.js).
// The app is served at http://localhost:<port>/CHINESE-HANDWRITING-PRACTICE-1/, the same path as on GitHub Pages.
// PDF checks use tools/check_pdf.py (PyMuPDF); they are skipped when it is not available.
// Set HANZI_PYTHON to choose the Python program.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });

const PYTHON = process.env.HANZI_PYTHON || 'python3';
let HAVE_PYMUPDF = true;
try {
  execFileSync(PYTHON, ['-c', 'import pymupdf'], { stdio: 'ignore' });
} catch {
  HAVE_PYMUPDF = false;
}
const checkPdf = file => JSON.parse(execFileSync(PYTHON, [path.join(ROOT, 'tools', 'check_pdf.py'), file, '--json'], { encoding: 'utf-8' }));

let server;
let browser;

before(async () => {
  server = await startServer();
  // A UTF-8 locale, so downloads keep Vietnamese and Chinese file names (Linux test machines
  // often have none; Windows and iPhone always do).
  browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

// A fresh browser profile (no cache, no service worker, empty localStorage) for each test.
async function openApp(options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  await page.goto(server.address);
  // Wait until the data files are loaded (the prompt is the last one).
  await page.waitForFunction(() => document.querySelector('#list') !== null);
  return { context, page, problems };
}

async function pasteAndRead(page, text, second = '') {
  await page.fill('#paste', text);
  if (second) {
    await page.click('#second summary');
    await page.fill('#paste2', second);
  }
  await page.click('#read-paste');
}

const wordsOnScreen = page => page.$$eval('#list .word .kai', nodes => nodes.map(n => n.textContent));
const flagsOf = (page, index) => page.$$eval(`#list .word:nth-child(${index + 1}) .flags li`, nodes => nodes.map(n => `${n.className}: ${n.textContent}`));

async function makePdf(page, boxSize, name) {
  await page.click('#tab-sheet');
  await page.check(`input[name="box-size"][value="${boxSize}"]`);
  await page.click('#make-pdf');
  await page.waitForSelector('#save-pdf:not([hidden])', { timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save-pdf')]);
  const file = path.join(OUT, name);
  await download.saveAs(file);
  return { file, suggested: download.suggestedFilename() };
}

test('the app loads with no errors, and the manifest id is /CHINESE-HANDWRITING-PRACTICE-1/', async () => {
  const { context, page, problems } = await openApp();
  assert.equal(await page.title(), 'Hanzi Grid');
  const id = await page.evaluate(async () => {
    const manifest = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
    return {
      id: new URL(manifest.id, location.origin).pathname,
      start: new URL(manifest.start_url, document.querySelector('link[rel=manifest]').href).pathname,
    };
  });
  assert.deepEqual(id, { id: '/CHINESE-HANDWRITING-PRACTICE-1/', start: '/CHINESE-HANDWRITING-PRACTICE-1/' });
  assert.deepEqual(problems, []);
  await context.close();
});

test('pasting mixed text gives exactly the Chinese words, in order, without repeats', async () => {
  const { context, page } = await openApp();
  await pasteAndRead(page, 'Bài 3: 女朋友 nǚ péngyou (bạn gái) girlfriend 123\n哪 nǎ, 国 guó; 女朋友 again, 她 tā');
  assert.deepEqual(await wordsOnScreen(page), ['女朋友', '哪', '国', '她']);
  assert.match(await page.textContent('#notices'), /1 repeated word/);
  await context.close();
});

test('warnings and errors: AI not sure, pinyin count, total, unusual and missing characters', async () => {
  const { context, page } = await openApp();
  await page.waitForFunction(() => document.querySelector('#copy-prompt') && true);
  await page.waitForTimeout(300);   // data files
  const reply = [
    '```', '# Bài 3',
    '1 | 女朋友 | nǚ péng you | girlfriend',
    '1 | 哪 | nǎ | which ?',
    '2 | 国 | guó guó | country',
    '2 | 犇 | bēn | to run ?',
    '3 | 國 | guó | country',
    '# total: 6', '```',
  ].join('\n');
  await pasteAndRead(page, reply);
  assert.deepEqual(await wordsOnScreen(page), ['女朋友', '哪', '国', '犇', '國']);
  assert.deepEqual(await flagsOf(page, 0), []);
  assert.ok((await flagsOf(page, 1)).some(f => f.startsWith('warn') && f.includes('not sure')));
  assert.ok((await flagsOf(page, 2)).some(f => f.startsWith('warn') && f.includes('2 syllable')));
  assert.ok((await flagsOf(page, 3)).some(f => f.startsWith('warn') && f.includes('Unusual character: 犇')));
  assert.ok(!(await flagsOf(page, 3)).some(f => f.startsWith('error')), 'an unusual character is only a warning');
  assert.ok((await flagsOf(page, 4)).some(f => f.startsWith('error') && f.includes('國')));
  assert.match(await page.textContent('#notices'), /total: 6/);
  // A red error blocks the PDF.
  await page.click('#tab-sheet');
  assert.equal(await page.isDisabled('#make-pdf'), true);
  // Deleting the word fixes it.
  await page.click('#tab-words');
  await page.click('#list .word:nth-child(5) button[data-action="delete"]');
  await page.click('#tab-sheet');
  assert.equal(await page.isDisabled('#make-pdf'), false);
  await context.close();
});

test('two replies: words that differ or that only one AI has are marked', async () => {
  const { context, page } = await openApp();
  const a = '1 | 女朋友 | nǚ péngyou\n1 | 哪 | nǎ\n2 | 国 | guó\n# total: 3';
  const b = '1 | 女朋友 | nǚ péngyou\n1 | 那 | nà\n2 | 国 | guó\n2 | 她 | tā\n# total: 4';
  await pasteAndRead(page, a, b);
  const words = await wordsOnScreen(page);
  assert.ok(words.includes('她'), 'the word only the second AI found is shown');
  const all = await page.$$eval('#list .flags li', nodes => nodes.map(n => n.textContent).join(' | '));
  assert.match(all, /second AI read “那”/);
  assert.match(all, /Only the second AI/);
  assert.match(await page.textContent('#notices'), /differ in 2 place/);
  await context.close();
});

test('rows: buttons, Page, and changing the box size lowers big numbers', async () => {
  const { context, page } = await openApp();
  await pasteAndRead(page, '女朋友\n哪\n国');
  await page.click('#list .word:nth-child(1) button[data-rows="Page"]');
  await page.fill('#list .word:nth-child(2) input[data-action="rows-number"]', '20');
  await page.press('#list .word:nth-child(2) input[data-action="rows-number"]', 'Enter');
  await page.click('#tab-sheet');
  await page.check('input[name="box-size"][value="large"]');
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('chinese-handwriting-practice-1.current')).entries.map(e => e.rows));
  assert.deepEqual(rows, ['Page', 15, 3]);
  // Large boxes: Page (17 rows), 15 (17 rows) and 3 (5 rows) each need their own page.
  assert.match(await page.textContent('#sheet-summary'), /3 word\(s\) on 3 page\(s\)/);
  // Every key the app wrote starts with "chinese-handwriting-practice-1.".
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.ok(keys.length > 0 && keys.every(k => k.startsWith('chinese-handwriting-practice-1.')), keys.join(','));
  await context.close();
});

test('Copy AI prompt puts prompts/worksheet.txt on the clipboard', async () => {
  const { context, page } = await openApp({ permissions: ['clipboard-read', 'clipboard-write'] });
  await page.waitForTimeout(300);
  await page.click('#copy-prompt');
  await page.waitForSelector('#message.ok');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, fs.readFileSync(path.join(ROOT, 'prompts', 'worksheet.txt'), 'utf-8'));
  await context.close();
});

test('makes PDFs in both box sizes, named after the list, with both fonts embedded', async () => {
  const { context, page, problems } = await openApp();
  await pasteAndRead(page, '# Bài 3–4\n女朋友 | nǚ péngyou | girlfriend\n哪 | nǎ | which\n国 | guó | country\n工作');
  for (const size of ['small', 'large']) {
    const { file, suggested } = await makePdf(page, size, `app-${size}.pdf`);
    assert.equal(suggested, 'Bài 3–4_grid.pdf');
    assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-');
    if (HAVE_PYMUPDF) {
      const info = checkPdf(file);
      assert.equal(info.title, 'Bài 3–4');
      const names = info.fonts.map(f => f.name);
      assert.ok(names.some(n => n.includes('UKaiCN')) && names.some(n => n.includes('NotoSansSC')), names.join(','));
      assert.ok(info.fonts.every(f => f.embedded && f.bytes < 100_000));
      if (size === 'large') assert.match(info.text.join(' '), /nǚ péngyou/);
    }
    await page.click('#tab-words');
  }
  assert.deepEqual(problems, []);
  await context.close();
});

test('practice sheet: missing pinyin is listed but still prints, in 14, 12 and 10 mm boxes', async () => {
  const { context, page, problems } = await openApp();
  await pasteAndRead(page, '# Bài 3\n女朋友 | nǚ péngyou | girlfriend\n哪 | nǎ\n国\n工作 | gōngzuò | work');
  await page.click('#tab-sheet');
  await page.check('input[name="sheet-type"][value="practice"]');
  assert.equal(await page.isHidden('#grid-options'), true);
  const missing = await page.textContent('#missing');
  assert.match(missing, /No pinyin \(1\): 国/);
  assert.match(missing, /No meaning \(2\): 哪, 国/);
  assert.equal(await page.isDisabled('#make-pdf'), false, 'missing pinyin does not block printing');
  // The rows control is hidden on tab 1 in practice mode.
  await page.click('#tab-words');
  assert.equal(await page.locator('#list .rows').count(), 0);
  assert.ok((await flagsOf(page, 2)).some(f => f.startsWith('warn') && f.includes('No pinyin')));
  await page.click('#tab-sheet');
  for (const box of ['14', '12', '10']) {
    await page.check(`input[name="practice-box"][value="${box}"]`);
    await page.click('#make-pdf');
    await page.waitForSelector('#save-pdf:not([hidden])', { timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save-pdf')]);
    assert.equal(download.suggestedFilename(), 'Bài 3_practice.pdf');
    const file = path.join(OUT, `app-practice-${box}.pdf`);
    await download.saveAs(file);
    if (HAVE_PYMUPDF) {
      const text = checkPdf(file).text.join('\n');
      assert.match(text, /PART 3: MIXED PRACTICE \(12\)/);
      assert.match(text, /女|朋/);
    }
  }
  // Back to the grid sheet: the rows control returns.
  await page.check('input[name="sheet-type"][value="grid"]');
  await page.click('#tab-words');
  assert.equal(await page.locator('#list .rows').count(), 4);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Split keeps the word with its characters under it; the pinyin prompt fills them in', async () => {
  const { context, page, problems } = await openApp({ permissions: ['clipboard-read', 'clipboard-write'] });
  let questions = 0;
  page.on('dialog', dialog => { questions++; dialog.accept(); });
  await page.waitForTimeout(300);
  await pasteAndRead(page, '# Bài 3\n女朋友 | nǚ péngyou | girlfriend\n姐姐 | jiějie | older sister\n国 | guó | country\n中国 | Zhōngguó | China');

  // Split one word: it stays, with its characters under it and the pinyin of the word.
  await page.click('#list .word:nth-child(1) button[data-action="split"]');
  assert.deepEqual(await wordsOnScreen(page), ['女朋友', '女', '朋', '友', '姐姐', '国', '中国']);
  assert.equal(await page.locator('#list .word.part').count(), 3);
  assert.match(await page.textContent('#list .word:nth-child(4) .info'), /you/);
  assert.ok((await flagsOf(page, 3)).some(f => f.startsWith('warn') && f.includes('Pinyin taken from 女朋友')));
  // A single character has no Split button; Unsplit takes the characters away again.
  assert.equal(await page.locator('#list .word:nth-child(2) button[data-action="split"]').count(), 0);
  await page.click('#list .word:nth-child(1) button[data-action="unsplit"]');
  assert.deepEqual(await wordsOnScreen(page), ['女朋友', '姐姐', '国', '中国']);

  // Split all: one question. A character already in the list is a grey repeat, not printed.
  await page.click('#split-all');
  assert.equal(questions, 1);
  assert.deepEqual(await wordsOnScreen(page), ['女朋友', '女', '朋', '友', '姐姐', '姐', '姐', '国', '中国', '中', '国']);
  assert.equal(await page.locator('#list .word.repeat').count(), 2);
  assert.match(await page.textContent('#notices'), /2 repeat\(s\) in grey/);
  // 国 under 中国 took its pinyin and meaning from the 国 row.
  assert.match(await page.textContent('#list .word:nth-child(11) .info'), /guó country/);
  await page.click('#tab-sheet');
  assert.match(await page.textContent('#sheet-summary'), /9 word\(s\)/);
  await page.click('#tab-words');
  // "Print again" prints a repeat anyway; "Print once" undoes it.
  await page.click('#list .word:nth-child(11) button[data-action="again"]');
  assert.equal(await page.locator('#list .word.repeat').count(), 1);
  await page.click('#list .word:nth-child(11) button[data-action="once"]');
  assert.equal(await page.locator('#list .word.repeat').count(), 2);
  await page.click('#split-all');
  assert.match(await page.textContent('#list-message'), /nothing to split/);

  // The prompt lists each word whose characters need help, with all its characters.
  await page.click('#copy-pinyin-prompt');
  await page.waitForSelector('#list-message.ok');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.endsWith('THE LIST:\n女朋友\n> 女\n> 朋\n> 友\n姐姐\n> 姐\n> 姐\n中国\n> 中\n> 国\n'), copied.slice(-80));

  // The AI's reply fills in each character place by place: same order, rows kept, no question.
  await pasteAndRead(page, '```\n女朋友 | nǚ péngyou | girlfriend\n> 女 | nǚ | woman\n> 朋 | péng | friend\n' +
    '> 友 | yǒu → you | friend\n姐姐 | jiějie | older sister\n> 姐 | jiě | older sister\n> 姐 | jiě → jie | older sister\n' +
    '中国 | Zhōngguó | China\n> 中 | zhōng | middle\n> 国 | guó | country\n```');
  assert.equal(questions, 1);
  assert.match(await page.textContent('#message'), /Filled in the pinyin and meaning of 6 word/);
  assert.match(await page.textContent('#list .word:nth-child(4) .info'), /yǒu → you friend/);
  const count = await page.locator('#list .word').count();
  for (let i = 0; i < count; i++) assert.ok(!(await flagsOf(page, i)).some(f => f.includes('Pinyin taken')), `word ${i}`);
  assert.doesNotMatch(await page.textContent('#notices'), /Split /);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chinese-handwriting-practice-1.current')).entries);
  assert.ok(saved.every(entry => entry.rows === 3));

  // A reply that only repeats the prompt's example is not loaded.
  await pasteAndRead(page, '山 | shān | mountain\n水果 | shuǐguǒ | fruit\n> 水 | shuǐ → shuí | water');
  assert.match(await page.textContent('#message'), /only repeats the example/);
  assert.equal(await page.locator('#list .word').count(), count);
  assert.deepEqual(problems, []);
  await context.close();
});

test('an answer with "> " lines and sentences: parts under their word, repeats in grey, every sheet prints', async () => {
  const { context, page, problems } = await openApp({ permissions: ['clipboard-read', 'clipboard-write'] });
  await page.waitForTimeout(300);
  // Both new prompts are on buttons.
  await page.click('#copy-sentence-prompt');
  await page.waitForSelector('#message.ok');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fs.readFileSync(path.join(ROOT, 'prompts', 'sentences.txt'), 'utf-8'));

  const sentence = '你好！我叫李小雨。我是中国人，我买一本书。';
  const answer = [
    '```', '# Bài 9',
    '1 | 二十 | èrshí | twenty', '> 二 | èr | two', '> 十 | shí | ten',
    '1 | 十一 | shíyī | eleven', '> 十 | shí | ten', '> 一 | yī | one',
    '2 | 我买一本书。 | Wó mǎi yì běn shū. | I buy a book.', '> 我 | wǒ → wó | I', '> 买 | mǎi | to buy',
    '> 一 | yī → yì | one', '> 本 | běn | (measure word)', '> 书 | shū | book',
    `2 | ${sentence} | Ní hǎo! Wǒ jiào Lǐ Xiáoyǔ. Wǒ shì Zhōngguó rén, wó mǎi yì běn shū. | Hello! I am Li Xiaoyu. I am Chinese, I buy a book.`,
    '# total: 4', '```',
  ].join('\n');
  // An unfinished answer is not read; all its parts pasted together are.
  await pasteAndRead(page, answer.replace('# total: 4', '# continue from page 3'));
  assert.match(await page.textContent('#message'), /not finished: the AI stopped before page 3/);
  await pasteAndRead(page, answer);
  assert.match(await page.textContent('#message'), /Read 4 word\(s\) with 9 line\(s\) under them/);
  assert.equal(await page.locator('#list .word.part').count(), 9);
  assert.equal(await page.locator('#list .word.repeat').count(), 2);
  assert.match(await page.textContent('#list .word.repeat >> nth=1'), /yī → yì/);
  assert.equal(await page.textContent('#notices'), '2 repeat(s) in grey: a word is printed only the first time it appears. Press “Print again” to print one anyway.');
  // No warning on a part whose pinyin is the character's own; the sentence keeps its punctuation.
  assert.deepEqual(await flagsOf(page, 1), []);
  assert.ok((await wordsOnScreen(page)).includes(sentence));

  // Save list writes the "> " lines and reading the file back gives the same list.
  const [listDownload] = await Promise.all([page.waitForEvent('download'), page.click('#save-list')]);
  const listFile = path.join(OUT, 'nested-list.txt');
  await listDownload.saveAs(listFile);
  const saved = fs.readFileSync(listFile, 'utf-8');
  assert.match(saved, /\n> 我 \| wǒ → wó \| I\n/);
  assert.ok(saved.includes(`\n${sentence} | `));

  // Every sheet: the long sentence carries on to the next line; arrows and punctuation print.
  for (const size of ['small', 'large']) {
    const { file } = await makePdf(page, size, `nested-${size}.pdf`);
    if (HAVE_PYMUPDF) {
      const text = checkPdf(file).text.join('');
      assert.ok(text.includes('。') && text.includes('！'), size);
      if (size === 'large') assert.ok(text.includes('wǒ → wó'));
    }
  }
  await page.check('input[name="sheet-type"][value="practice"]');
  await page.click('#make-pdf');
  await page.waitForSelector('#save-pdf:not([hidden])', { timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save-pdf')]);
  const practiceFile = path.join(OUT, 'nested-practice.pdf');
  await download.saveAs(practiceFile);
  if (HAVE_PYMUPDF) {
    const text = checkPdf(practiceFile).text.join('\n');
    assert.match(text, /PART 3: MIXED PRACTICE \(33\)/);   // 11 printed items (no repeats) x 3 rounds
    assert.ok(text.includes('Hello! I am Li Xiaoyu.'));
  }
  assert.deepEqual(problems, []);
  await context.close();
});

test('the page keeps responding while a 300-word PDF is built', async () => {
  const { context, page } = await openApp();
  // 300 different two-character words from the common list.
  const common = fs.readFileSync(path.join(ROOT, 'data', 'common3500.txt'), 'utf-8').split('\n').filter(Boolean);
  const words = Array.from({ length: 300 }, (_, i) => common[i] + common[i + 300]);
  await pasteAndRead(page, words.join('\n'));
  assert.equal((await wordsOnScreen(page)).length, 300);
  await page.click('#tab-sheet');
  // Record the largest gap between timer ticks while the worker builds the PDF.
  await page.evaluate(() => {
    window.__gaps = [];
    let last = performance.now();
    window.__timer = setInterval(() => {
      const now = performance.now();
      window.__gaps.push(now - last);
      last = now;
    }, 10);
  });
  await page.click('#make-pdf');
  await page.waitForSelector('#save-pdf:not([hidden])', { timeout: 120_000 });
  const gaps = await page.evaluate(() => { clearInterval(window.__timer); return window.__gaps; });
  const worst = Math.max(...gaps);
  assert.ok(gaps.length > 5, 'the build took some time');
  assert.ok(worst < 100, `largest pause ${worst.toFixed(0)} ms`);
  await context.close();
});

test('picture-only PDFs and photos show the "use the AI prompt" message', async () => {
  const { context, page } = await openApp();
  const liao = path.join(ROOT, 'samples', 'Luyện viết HSK1 - (Part 3).pdf');
  const files = [path.join(ROOT, 'icons', 'icon-192.png')];
  if (fs.existsSync(liao)) files.push(liao);
  for (const file of files) {
    await page.setInputFiles('#file-input', file);
    await page.waitForSelector('#message.problem', { timeout: 60_000 });
    assert.match(await page.textContent('#message'), /picture, there is no text inside/);
    await page.evaluate(() => { document.querySelector('#message').className = 'message'; });
  }
  await context.close();
});

test('offline: after one visit the app opens, reads a file and makes PDFs; only its own caches change', async () => {
  const { context, page } = await openApp();
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  // Wait for the service worker to install every file, then reload so it controls the page.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Another app on the same origin has a cache; an old version of this app has one too.
  await page.evaluate(async () => {
    await (await caches.open('otherapp-v1')).put('/other/x', new Response('x'));
    // An older app on the same site that used the prefix "hanzigrid-" must not be touched either.
    await (await caches.open('hanzigrid-v1')).put('/hanzi-grid/x', new Response('x'));
    await (await caches.open('chinese-handwriting-practice-1-old')).put('/CHINESE-HANDWRITING-PRACTICE-1/x', new Response('x'));
  });
  // A "new version": unregister and register again, so install + activate run again.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.unregister();
  });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => !(await caches.keys()).includes('chinese-handwriting-practice-1-old'), null, { timeout: 30_000 });
  const names = await page.evaluate(() => caches.keys());
  assert.ok(names.includes('otherapp-v1'), 'the other app’s cache is untouched');
  assert.ok(names.includes('hanzigrid-v1'), 'a cache with a similar name is untouched');
  assert.equal(names.filter(n => n.startsWith('chinese-handwriting-practice-1-')).length, 1, names.join(','));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Now with no network at all.
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#read-paste');
  await page.waitForTimeout(300);
  const docx = ['lesson.docx', 'paragraphs.docx', 'basic.docx']
    .map(name => path.join(ROOT, 'tests', 'fixtures', name)).find(f => fs.existsSync(f))
    || fs.readdirSync(path.join(ROOT, 'tests', 'fixtures')).filter(n => n.endsWith('.docx')).map(n => path.join(ROOT, 'tests', 'fixtures', n))[0];
  if (docx) {
    await page.setInputFiles('#file-input', docx);
    await page.waitForSelector('#message.ok', { timeout: 30_000 });
  } else {
    await pasteAndRead(page, '女朋友\n哪');
  }
  assert.ok((await wordsOnScreen(page)).length > 0);
  for (const size of ['small', 'large']) {
    const { file } = await makePdf(page, size, `offline-${size}.pdf`);
    assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-');
    await page.click('#tab-words');
  }
  const foreign = requests.filter(url => !url.startsWith('http://localhost') && !url.startsWith('blob:') && !url.startsWith('data:'));
  assert.deepEqual(foreign, [], 'nothing is fetched from any other site');
  await context.close();
});
