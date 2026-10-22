// The screen: tabs, the check list, buttons. Only this file touches the page.
// Reading text is in extract.js / readers.js; the PDF is built by sheet-worker.js.

import { readText, compareReplies, countSyllables, toLessonText, safeFileName } from './extract.js';
import { readFile } from './readers.js';
import { layoutSheet, emptyRows, SIZES } from './layout.js';
import { loadSettings, saveSettings, loadCurrent, saveCurrent, saveFile } from './store.js';

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

const settings = loadSettings();
// The current list. Each entry is an Entry from extract.js plus rows (a number or "Page").
let list = loadCurrent() || { name: '', entries: [], notices: [] };
let editing = -1;        // index of the word being edited, or -1
let pdfBlob = null;      // the last PDF built
let worker = null;

// Loaded at start-up (and cached by the service worker for offline use).
let common = new Set();      // the 3,500 common characters
let fontChars = new Set();   // characters that both fonts have
let promptText = '';         // the AI prompt

const $ = id => document.getElementById(id);

// Make an element: el('li', { class: 'warn' }, 'text', child, ...)
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function save() {
  saveCurrent(list);
}

function showMessage(text, kind = '') {
  const box = $('message');
  box.textContent = text;
  box.className = 'message ' + kind;
}

// ---------------------------------------------------------------------------------------
// Warnings (orange) and errors (red) for one word
// ---------------------------------------------------------------------------------------

function checkEntry(entry) {
  const warnings = [];
  const errors = [];
  const chars = [...entry.word];
  if (entry.unsure) warnings.push('The AI was not sure (?)');
  if (entry.compare === 'differs') warnings.push(`The second AI read “${entry.other}”`);
  if (entry.compare === 'onlyA') warnings.push('Only the first AI found this word');
  if (entry.compare === 'onlyB') warnings.push('Only the second AI found this word');
  if (entry.pinyin) {
    const syllables = countSyllables(entry.pinyin);
    if (syllables !== chars.length) {
      warnings.push(`The pinyin has ${syllables} syllable(s) for ${chars.length} character(s)`);
    }
  }
  const unusual = [...new Set(chars.filter(ch => !common.has(ch)))];
  if (unusual.length && common.size) warnings.push(`Unusual character: ${unusual.join(' ')}`);
  const missing = [...new Set(chars.filter(ch => !fontChars.has(ch)))];
  if (missing.length && fontChars.size) {
    errors.push(`Not in the app's fonts: ${missing.join(' ')} (a traditional or rare character?)`);
  }
  const columns = SIZES[settings.boxSize].columns;
  if (chars.length > columns) {
    errors.push(`Too long: ${chars.length} characters, the sheet has ${columns} columns`);
  }
  return { warnings, errors };
}

function errorCount() {
  return list.entries.filter(entry => checkEntry(entry).errors.length).length;
}

// ---------------------------------------------------------------------------------------
// Drawing the check list
// ---------------------------------------------------------------------------------------

function rowsControl(entry, index) {
  const max = SIZES[settings.boxSize].maxRows;
  const box = el('div', { class: 'rows', role: 'group', 'aria-label': 'Empty rows' }, el('span', {}, 'Rows:'));
  for (const choice of [1, 3, 6, 'Page']) {
    box.append(el('button', {
      type: 'button', 'data-action': 'rows', 'data-index': index, 'data-rows': choice,
      'aria-pressed': String(entry.rows === choice),
    }, String(choice)));
  }
  box.append(el('input', {
    type: 'number', min: 0, max, inputmode: 'numeric', 'aria-label': 'Number of empty rows',
    'data-action': 'rows-number', 'data-index': index,
    value: emptyRows(entry.rows, settings.boxSize),
  }));
  return box;
}

function editForm(entry, index) {
  const form = el('form', { class: 'edit-form', 'data-index': index },
    el('label', {}, 'Word', el('input', { type: 'text', name: 'word', lang: 'zh', value: entry.word })),
    el('label', {}, 'Pinyin', el('input', { type: 'text', name: 'pinyin', value: entry.pinyin })),
    el('label', {}, 'Meaning', el('input', { type: 'text', name: 'meaning', value: entry.meaning })),
    el('div', { class: 'buttons' },
      el('button', { type: 'submit', class: 'primary' }, 'Save'),
      el('button', { type: 'button', 'data-action': 'cancel-edit' }, 'Cancel')),
  );
  return form;
}

function wordRow(entry, index) {
  const { warnings, errors } = checkEntry(entry);
  const info = [];
  if (entry.pinyin) info.push(el('b', {}, entry.pinyin));
  if (entry.meaning) info.push(' ', entry.meaning);
  if (entry.page !== null && entry.page !== undefined) info.push(` · page ${entry.page}`);

  const item = el('li', { class: 'word' },
    el('div', { class: 'preview', lang: 'zh' },
      el('span', { class: 'kai' }, entry.word),
      el('span', { class: 'print' }, entry.word)),
    el('div', { class: 'info' }, ...(info.length ? info : ['no pinyin'])),
    (warnings.length || errors.length) ? el('ul', { class: 'flags' },
      ...errors.map(text => el('li', { class: 'error' }, text)),
      ...warnings.map(text => el('li', { class: 'warn' }, text))) : el('div'),
    rowsControl(entry, index),
  );
  if (editing === index) {
    item.append(editForm(entry, index));
  } else {
    const last = list.entries.length - 1;
    item.append(el('div', { class: 'actions' },
      el('button', { type: 'button', 'data-action': 'edit', 'data-index': index }, 'Edit'),
      el('button', { type: 'button', 'data-action': 'up', 'data-index': index, disabled: index === 0, 'aria-label': 'Move up' }, '↑'),
      el('button', { type: 'button', 'data-action': 'down', 'data-index': index, disabled: index === last, 'aria-label': 'Move down' }, '↓'),
      el('button', { type: 'button', 'data-action': 'merge', 'data-index': index, disabled: index === last, 'aria-label': 'Merge with next word' }, 'Merge ↓'),
      el('button', { type: 'button', 'data-action': 'delete', 'data-index': index }, 'Delete'),
    ));
  }
  return item;
}

function render() {
  $('list-name').value = list.name;
  const words = $('list');
  words.replaceChildren(...list.entries.map(wordRow));
  $('empty').hidden = list.entries.length > 0;
  $('notices').replaceChildren(...list.notices.map(text => el('p', { class: 'notice' }, text)));
  renderSheetTab();
}

function renderSheetTab() {
  for (const radio of document.querySelectorAll('input[name="box-size"]')) {
    radio.checked = radio.value === settings.boxSize;
  }
  $('default-rows').value = settings.defaultRows;
  $('default-rows').max = SIZES[settings.boxSize].maxRows;
  const summary = $('sheet-summary');
  const errors = errorCount();
  if (!list.entries.length) {
    summary.textContent = 'The list is empty. Add words on tab 1 first.';
  } else if (errors) {
    summary.textContent = `${errors} word(s) have a red error. Fix them on tab 1 before making the PDF.`;
  } else {
    const pages = layoutSheet(sheetItems(), settings.boxSize).pages.length;
    summary.textContent = `“${list.name || 'Untitled'}”: ${list.entries.length} word(s) on ${pages} page(s).`;
  }
  $('make-pdf').disabled = !list.entries.length || errors > 0;
}

function sheetItems() {
  return list.entries.map(({ word, pinyin, meaning, rows }) => ({ word, pinyin, meaning, rows }));
}

// A new list was read: forget the old PDF, store and draw.
function listChanged() {
  pdfBlob = null;
  $('save-pdf').hidden = true;
  $('progress').textContent = '';
  save();
  render();
}

// ---------------------------------------------------------------------------------------
// Getting words
// ---------------------------------------------------------------------------------------

function useResult(result, second = null) {
  if (result.echoedExample) {
    showMessage('This reply only repeats the example from the prompt. Paste the AI’s real answer.', 'problem');
    return;
  }
  let entries = result.entries;
  const notices = [];
  if (second) {
    if (second.echoedExample) {
      showMessage('The second reply only repeats the example from the prompt.', 'problem');
      return;
    }
    entries = compareReplies(result.entries, second.entries);
    const differences = entries.filter(entry => entry.compare && entry.compare !== 'same').length;
    notices.push(differences
      ? `The two AI replies differ in ${differences} place(s). Check the orange words.`
      : 'The two AI replies agree on every word.');
  }
  if (!entries.length) {
    showMessage('No Chinese words found in this text.', 'problem');
    return;
  }
  if (list.entries.length && !window.confirm(`Replace the current list (${list.entries.length} words)?`)) return;
  if (result.removed) notices.push(`${result.removed} repeated word(s) were removed.`);
  if (result.total !== null && result.total !== undefined && result.total !== result.lines) {
    notices.push(`The AI wrote “total: ${result.total}” but the reply has ${result.lines} word line(s). A word may be missing.`);
  }
  list = {
    name: result.name,
    entries: entries.map(entry => ({ ...entry, rows: settings.defaultRows })),
    notices,
  };
  editing = -1;
  showMessage(`Read ${entries.length} word(s).`, 'ok');
  listChanged();
}

function readPasted() {
  const text = $('paste').value;
  if (!text.trim()) {
    showMessage('Paste some text into the box first.', 'problem');
    return;
  }
  const secondText = $('paste2').value;
  const result = readText(text, 'Untitled');
  const second = secondText.trim() ? readText(secondText, 'Untitled') : null;
  useResult(result, second);
}

async function openFile(file) {
  showMessage(`Reading ${file.name}…`);
  try {
    const read = await readFile(file);
    if (read.picture) {
      showMessage('This PDF is a picture, there is no text inside. Use “Copy AI prompt”, then paste the AI’s reply here.', 'problem');
      return;
    }
    useResult(readText(read.text, read.name));
  } catch (error) {
    showMessage(`Could not read ${file.name}: ${error.message}`, 'problem');
  }
}

function copyPrompt() {
  const fallback = () => {
    $('prompt-text').value = promptText;
    $('prompt-box').hidden = false;
  };
  if (!promptText) {
    showMessage('The prompt is not loaded yet. Try again in a moment.', 'problem');
    return;
  }
  // Called directly inside the tap, with the text already loaded (iPhone needs both).
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(promptText).then(
      () => showMessage('AI prompt copied. Paste it into ChatGPT, Gemini or Claude with your worksheet.', 'ok'),
      fallback);
  } else {
    fallback();
  }
}

// ---------------------------------------------------------------------------------------
// Changing the list
// ---------------------------------------------------------------------------------------

function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  const entries = list.entries;
  switch (button.dataset.action) {
    case 'rows': {
      const value = button.dataset.rows;
      entries[index].rows = value === 'Page' ? 'Page' : Number(value);
      break;
    }
    case 'edit':
      editing = index;
      break;
    case 'cancel-edit':
      editing = -1;
      break;
    case 'up':
      if (index > 0) [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
      break;
    case 'down':
      if (index < entries.length - 1) [entries[index + 1], entries[index]] = [entries[index], entries[index + 1]];
      break;
    case 'delete':
      entries.splice(index, 1);
      editing = -1;
      break;
    case 'merge': {
      const [first, next] = [entries[index], entries[index + 1]];
      if (!next) break;
      entries.splice(index, 2, {
        ...first,
        word: first.word + next.word,
        pinyin: [first.pinyin, next.pinyin].filter(Boolean).join(' '),
        meaning: [first.meaning, next.meaning].filter(Boolean).join('; '),
        unsure: first.unsure || next.unsure,
      });
      editing = -1;
      break;
    }
    default:
      return;
  }
  listChanged();
}

function onListChange(event) {
  const input = event.target;
  if (input.dataset.action !== 'rows-number') return;
  const index = Number(input.dataset.index);
  const max = SIZES[settings.boxSize].maxRows;
  let n = Math.floor(Number(input.value));
  if (!Number.isFinite(n) || n < 0) n = 0;
  list.entries[index].rows = n >= max ? 'Page' : n;
  listChanged();
}

// Only Chinese characters are kept in a word, as everywhere else.
function chineseOnly(text) {
  const found = readText(text.normalize('NFKC'), '').entries.map(entry => entry.word);
  return found.join('');
}

function onEditSubmit(event) {
  const form = event.target.closest('.edit-form');
  if (!form) return;
  event.preventDefault();
  const index = Number(form.dataset.index);
  const word = chineseOnly(form.elements.word.value);
  if (!word) {
    showMessage('A word needs at least one Chinese character.', 'problem');
    return;
  }
  Object.assign(list.entries[index], {
    word,
    pinyin: form.elements.pinyin.value.trim(),
    meaning: form.elements.meaning.value.trim(),
    unsure: false,
  });
  editing = -1;
  listChanged();
}

function addWord(event) {
  event.preventDefault();
  const word = chineseOnly($('add-word').value);
  if (!word) {
    showMessage('Type or paste a word with Chinese characters.', 'problem');
    return;
  }
  list.entries.push({
    word, pinyin: '', meaning: '', page: null, unsure: false, compare: null, other: '',
    rows: settings.defaultRows,
  });
  $('add-word').value = '';
  listChanged();
}

// ---------------------------------------------------------------------------------------
// Making the PDF
// ---------------------------------------------------------------------------------------

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./sheet-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = event => {
    const message = event.data;
    if (message.type === 'progress') {
      $('progress').textContent = message.text;
    } else if (message.type === 'done') {
      pdfBlob = new Blob([message.pdf], { type: 'application/pdf' });
      $('progress').textContent = `Done: ${message.pages} page(s). Press “Save PDF”.`;
      $('progress').className = 'message ok';
      $('save-pdf').hidden = false;
      $('make-pdf').disabled = false;
    } else if (message.type === 'error') {
      $('progress').textContent = `The PDF could not be made: ${message.message}`;
      $('progress').className = 'message problem';
      $('make-pdf').disabled = false;
    }
  };
  worker.onerror = event => {
    $('progress').textContent = `The PDF maker did not start: ${event.message || 'unknown problem'}`;
    $('progress').className = 'message problem';
    $('make-pdf').disabled = false;
    worker = null;
  };
  return worker;
}

function makePdf() {
  if (!list.entries.length || errorCount()) return;
  pdfBlob = null;
  $('save-pdf').hidden = true;
  $('make-pdf').disabled = true;
  $('progress').className = 'message';
  $('progress').textContent = 'Starting…';
  startWorker().postMessage({ items: sheetItems(), boxSize: settings.boxSize, title: list.name || 'Untitled' });
}

function savePdf() {
  if (!pdfBlob) return;
  const name = `${safeFileName(list.name || 'Untitled')}_grid.pdf`;
  saveFile(pdfBlob, name).catch(error => {
    $('progress').textContent = `Could not save: ${error.message}`;
    $('progress').className = 'message problem';
  });
}

function saveList() {
  if (!list.entries.length) {
    showMessage('The list is empty.', 'problem');
    return;
  }
  const text = toLessonText(list.name || 'Untitled', list.entries);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  saveFile(blob, `${safeFileName(list.name || 'Untitled')}.txt`).catch(error => {
    showMessage(`Could not save: ${error.message}`, 'problem');
  });
}

// ---------------------------------------------------------------------------------------
// Tabs and settings
// ---------------------------------------------------------------------------------------

function showTab(name) {
  const words = name === 'words';
  $('panel-words').hidden = !words;
  $('panel-sheet').hidden = words;
  $('tab-words').setAttribute('aria-selected', String(words));
  $('tab-sheet').setAttribute('aria-selected', String(!words));
  if (!words) renderSheetTab();
  window.scrollTo(0, 0);
}

function setBoxSize(size) {
  settings.boxSize = size;
  // "Page" stays a whole page; numbers above the new maximum become the maximum.
  const max = SIZES[size].maxRows;
  for (const entry of list.entries) {
    if (entry.rows !== 'Page' && entry.rows > max) entry.rows = max;
  }
  if (settings.defaultRows !== 'Page' && settings.defaultRows > max) settings.defaultRows = max;
  saveSettings(settings);
  listChanged();
}

function setDefaultRows() {
  const max = SIZES[settings.boxSize].maxRows;
  let n = Math.floor(Number($('default-rows').value));
  if (!Number.isFinite(n) || n < 0) n = 0;
  settings.defaultRows = Math.min(n, max);
  saveSettings(settings);
  renderSheetTab();
}

// ---------------------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------------------

async function loadText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return await response.text();
}

function lines(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean);
}

async function loadData() {
  const [commonText, fontText, prompt] = await Promise.all([
    loadText('data/common3500.txt'),
    loadText('data/font-chars.txt'),
    loadText('prompts/worksheet.txt'),
  ]);
  common = new Set(lines(commonText));
  fontChars = new Set(lines(fontText));
  promptText = prompt;
}

function wireUp() {
  $('tab-words').addEventListener('click', () => showTab('words'));
  $('tab-sheet').addEventListener('click', () => showTab('sheet'));
  $('to-sheet').addEventListener('click', () => showTab('sheet'));
  $('read-paste').addEventListener('click', readPasted);
  $('open-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';      // so the same file can be opened again
    if (file) openFile(file);
  });
  $('copy-prompt').addEventListener('click', copyPrompt);
  $('select-prompt').addEventListener('click', () => {
    $('prompt-text').focus();
    $('prompt-text').select();
  });
  $('list-name').addEventListener('input', event => {
    list.name = event.target.value;
    save();
  });
  $('list').addEventListener('click', onListClick);
  $('list').addEventListener('change', onListChange);
  $('list').addEventListener('submit', onEditSubmit);
  $('add-form').addEventListener('submit', addWord);
  $('save-list').addEventListener('click', saveList);
  $('clear-list').addEventListener('click', () => {
    if (list.entries.length && !window.confirm('Remove all words from the list?')) return;
    list = { name: '', entries: [], notices: [] };
    listChanged();
  });
  for (const radio of document.querySelectorAll('input[name="box-size"]')) {
    radio.addEventListener('change', () => setBoxSize(radio.value));
  }
  $('default-rows').addEventListener('change', setDefaultRows);
  $('rows-all').addEventListener('click', () => {
    setDefaultRows();
    for (const entry of list.entries) entry.rows = settings.defaultRows;
    listChanged();
  });
  $('make-pdf').addEventListener('click', makePdf);
  $('save-pdf').addEventListener('click', savePdf);
}

async function start() {
  wireUp();
  render();
  try {
    await loadData();
    render();
  } catch (error) {
    showMessage(`Some app files did not load (${error.message}). Connect to the internet once and reload.`, 'problem');
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

start();
