// The screen: tabs, the check list, buttons. Only this file touches the page.
// Reading text is in extract.js / readers.js; the PDF is built by sheet-worker.js.

import {
  readText, compareReplies, countSyllables, toLessonText, safeFileName, boxText, chineseChars, splitArrow, PUNCTUATION,
  EXAMPLE_MAX_BOXES, isSentence,
} from './extract.js';
import { readFile } from './readers.js';
import { layoutSheet, emptyRows, modelLines, tooLongForPage, exampleUnderline, exampleRows, SIZES } from './layout.js';
import { layoutPractice, practiceTooLong } from './practice.js';
import { loadSettings, saveSettings, loadCurrent, saveCurrent, saveFile } from './store.js';
import {
  splitEntries, canSplit, unsplit, deleteEntry, moveEntry, repeatFlags, printedEntries, partIndexes, groupEnd,
  allInList, fillIn, pinyinPrompt, isPinyinPromptExample, examplePrompt, isExamplePromptExample, dropLongExamples,
  pinyinFits, sentencePinyinFits,
} from './listedit.js';

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

const settings = loadSettings();
// The current list. Each entry is an Entry from extract.js plus rows (a number or "Page").
let list = loadCurrent() || { name: '', entries: [], notices: [] };
let editing = -1;        // index of the word being edited, or -1
let pdfBlob = null;      // the last PDF built
let pdfKind = 'grid';    // its sheet type, for the file name
let worker = null;

// Loaded at start-up (and cached by the service worker for offline use).
let common = new Set();      // the 3,500 common characters
let fontChars = new Set();   // characters that both fonts have
let promptText = '';         // the AI prompt for words (+ characters)
let sentencePromptText = ''; // the AI prompt for sentences (+ chunks)
let pinyinPromptText = '';   // the AI prompt for pinyin and meanings
let examplePromptText = '';  // the AI prompt for example sentences

// An English translation longer than this makes the example line print smaller: a warning.
const LONG_TRANSLATION = 60;

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

// The same, for the buttons under the list.
function listMessage(text, kind = '') {
  const box = $('list-message');
  box.textContent = text;
  box.className = 'message ' + kind;
}

// ---------------------------------------------------------------------------------------
// Warnings (orange) and errors (red) for one word
// ---------------------------------------------------------------------------------------


// The warnings and errors of the entry at `index` (a printed one: repeats are not checked).
function checkEntry(entry, index) {
  const warnings = [];
  const errors = [];
  const chars = chineseChars(entry.word);
  const count = [...chars].length;
  if (entry.unsure) warnings.push('The AI was not sure (?)');
  if (entry.compare === 'differs') warnings.push(`The second AI read “${entry.other}”`);
  if (entry.compare === 'onlyA') warnings.push('Only the first AI found this word');
  if (entry.compare === 'onlyB') warnings.push('Only the second AI found this word');
  // A character made by Split: its pinyin came from the word it was in.
  if (entry.splitFrom && entry.pinyin) {
    warnings.push(`Pinyin taken from ${entry.splitFrom}: check it on its own (tones can change inside a word)`);
  } else if (entry.splitFrom) {
    warnings.push(`The pinyin of ${entry.splitFrom} could not be split: add it with Edit or “Copy AI prompt: pinyin & meaning”`);
  }
  const fits = isSentence(entry.word) ? sentencePinyinFits : pinyinFits;
  if (entry.pinyin && !fits(entry.pinyin, chars)) {
    warnings.push(`The pinyin has ${countSyllables(entry.pinyin)} syllable(s) for ${count} character(s)`);
  }
  // The parts under a word must spell it.
  const parts = partIndexes(list.entries, index).map(i => chineseChars(list.entries[i].word)).join('');
  if (parts && parts !== chars) warnings.push(`The parts under it spell ${parts}, not ${chars}`);
  const unusual = [...new Set([...chars].filter(ch => !common.has(ch)))];
  if (unusual.length && common.size) warnings.push(`Unusual character: ${unusual.join(' ')}`);
  const missing = [...new Set([...entry.word].filter(ch => !PUNCTUATION.includes(ch) && !fontChars.has(ch)))];
  if (missing.length && fontChars.size) {
    errors.push(`Not in the app's fonts: ${missing.join(' ')} (a traditional or rare character?)`);
  }
  if (entry.example) checkExample(entry, warnings, errors);
  if (settings.sheetType === 'practice') {
    // Missing pinyin or meaning never blocks printing; the spot is just left empty.
    if (!entry.pinyin) warnings.push('No pinyin: left empty on the practice sheet');
    if (!entry.meaning) warnings.push('No meaning: left empty on the practice sheet');
    if (practiceTooLong(entry.word, settings.practiceBox)) errors.push('Too long for one page: split it with Edit');
  } else if (tooLongForPage(entry.word, settings.boxSize, exampleRows(entry, settings.boxSize))) {
    errors.push('Too long for one page: split it with Edit');
  }
  return { warnings, errors };
}

// The checks of an example sentence. It is printed only on the large-box sheet, so only there
// can a problem with it block printing; on the other sheets the same problem is a warning.
function checkExample(entry, warnings, errors) {
  const example = entry.example;
  const chars = chineseChars(example);
  const printed = settings.sheetType === 'grid' && settings.boxSize === 'large';
  if (entry.exampleUnsure) warnings.push('The AI was not sure of the example sentence (?)');
  // The underline under the word in the sentence shows the same thing on the sheet.
  if (!exampleUnderline(entry)) warnings.push(`The example sentence does not contain ${chineseChars(entry.word)}`);
  const lacking = [entry.examplePinyin ? '' : 'pinyin', entry.exampleMeaning ? '' : 'English'].filter(Boolean);
  if (lacking.length) warnings.push(`The example sentence has no ${lacking.join(' and no ')}`);
  if (entry.examplePinyin && !sentencePinyinFits(entry.examplePinyin, chars)) {
    warnings.push(`The example's pinyin has ${countSyllables(entry.examplePinyin)} syllable(s) for ${[...chars].length} character(s)`);
  }
  const unusual = [...new Set([...chars].filter(ch => !common.has(ch)))];
  if (unusual.length && common.size) warnings.push(`Unusual character in the example: ${unusual.join(' ')}`);
  const english = [...(entry.exampleMeaning || '')].length;
  if (english > LONG_TRANSLATION) {
    warnings.push(`Long English (${english} characters): the example line prints smaller. Shorten it with Edit`);
  }
  const boxes = [...example].length;
  if (boxes > EXAMPLE_MAX_BOXES) {
    (printed ? errors : warnings).push(`The example sentence has ${boxes} boxes, more than ${EXAMPLE_MAX_BOXES}: ` +
      'empty it with Edit and ask the AI for a new one');
  }
  const missing = [...new Set([...example].filter(ch => !PUNCTUATION.includes(ch) && !fontChars.has(ch)))];
  if (missing.length && fontChars.size) {
    (printed ? errors : warnings).push(`Not in the app's fonts: ${missing.join(' ')} (in the example sentence)`);
  }
}

function errorCount() {
  const repeats = repeatFlags(list.entries);
  return list.entries.filter((entry, i) => !repeats[i] && checkEntry(entry, i).errors.length).length;
}

// ---------------------------------------------------------------------------------------
// Drawing the check list
// ---------------------------------------------------------------------------------------

function rowsControl(entry, index) {
  const lines = modelLines(entry.word, settings.boxSize);
  const extra = exampleRows(entry, settings.boxSize);   // the example sentence's row (large boxes)
  const box = el('div', { class: 'rows', role: 'group', 'aria-label': 'Empty rows' }, el('span', {}, 'Rows:'));
  for (const choice of [1, 3, 6, 'Page']) {
    box.append(el('button', {
      type: 'button', 'data-action': 'rows', 'data-index': index, 'data-rows': choice,
      'aria-pressed': String(entry.rows === choice),
    }, String(choice)));
  }
  box.append(el('input', {
    type: 'number', min: 0, max: emptyRows('Page', settings.boxSize, lines, extra), inputmode: 'numeric',
    'aria-label': 'Number of empty rows', 'data-action': 'rows-number', 'data-index': index,
    value: emptyRows(entry.rows, settings.boxSize, lines, extra),
  }));
  return box;
}

// "nǐ → ní": the pinyin, and the pinyin as said when it differs.
function pinyinText(entry) {
  return entry.said ? `${entry.pinyin} → ${entry.said}` : entry.pinyin;
}

// The example sentence on the check screen, with its word underlined as on the sheet.
function exampleView(entry) {
  const where = exampleUnderline(entry);
  const sentence = where
    ? [entry.example.slice(0, where.start), el('u', {}, entry.example.slice(where.start, where.end)), entry.example.slice(where.end)]
    : [entry.example];
  return el('div', { class: 'example' },
    el('span', { class: 'example-zh', lang: 'zh' }, ...sentence),
    entry.examplePinyin ? ` ${entry.examplePinyin}` : null,
    entry.exampleMeaning ? ` - ${entry.exampleMeaning}` : null);
}

function editForm(entry, index) {
  const form = el('form', { class: 'edit-form', 'data-index': index },
    el('label', {}, 'Word', el('input', { type: 'text', name: 'word', lang: 'zh', value: entry.word })),
    el('label', {}, 'Pinyin (a tone change: nǐ → ní)', el('input', { type: 'text', name: 'pinyin', value: pinyinText(entry) })),
    el('label', {}, 'Meaning', el('input', { type: 'text', name: 'meaning', value: entry.meaning })),
    el('label', {}, `Example sentence (at most ${EXAMPLE_MAX_BOXES} boxes; empty = none)`,
      el('input', { type: 'text', name: 'example', lang: 'zh', value: entry.example || '' })),
    el('label', {}, 'Example pinyin', el('input', { type: 'text', name: 'examplePinyin', value: entry.examplePinyin || '' })),
    el('label', {}, 'Example in English', el('input', { type: 'text', name: 'exampleMeaning', value: entry.exampleMeaning || '' })),
    el('p', { class: 'message problem form-message', role: 'alert' }),
    el('div', { class: 'buttons' },
      el('button', { type: 'submit', class: 'primary' }, 'Save'),
      el('button', { type: 'button', 'data-action': 'cancel-edit' }, 'Cancel')),
  );
  return form;
}

function button(action, index, text, more = {}) {
  return el('button', { type: 'button', 'data-action': action, 'data-index': index, ...more }, text);
}

// One row of the check list. Parts (depth 1 and 2) are indented under their word; a repeat
// is grey, is not printed and has only the "Print again" button.
function wordRow(entry, index, repeat) {
  const entries = list.entries;
  const depth = entry.depth || 0;
  const info = [];
  if (entry.pinyin) info.push(el('b', {}, pinyinText(entry)));
  if (entry.meaning) info.push(' ', entry.meaning);
  if (depth === 0 && entry.page !== null && entry.page !== undefined) info.push(` · page ${entry.page}`);

  const classes = ['word'];
  if (depth) classes.push('part', `depth-${depth}`);
  if (repeat) classes.push('repeat');
  const item = el('li', { class: classes.join(' ') },
    el('div', { class: 'preview', lang: 'zh' },
      el('span', { class: 'kai' }, entry.word),
      el('span', { class: 'print' }, entry.word)),
    el('div', { class: 'info' }, ...(info.length ? info : ['no pinyin']), entry.example ? exampleView(entry) : null),
  );
  if (repeat) {
    item.append(
      el('p', { class: 'hint' }, 'Printed above: not printed again.'),
      el('div', { class: 'actions' }, button('again', index, 'Print again')));
    return item;
  }

  const { warnings, errors } = checkEntry(entry, index);
  item.append(
    (warnings.length || errors.length) ? el('ul', { class: 'flags' },
      ...errors.map(text => el('li', { class: 'error' }, text)),
      ...warnings.map(text => el('li', { class: 'warn' }, text))) : el('div'),
    // Rows per word only matter on the grid sheet.
    settings.sheetType === 'grid' ? rowsControl(entry, index) : null,
  );
  if (editing === index) {
    item.append(editForm(entry, index));
    return item;
  }
  const hasParts = partIndexes(entries, index).length > 0;
  const actions = [button('edit', index, 'Edit')];
  if (depth === 0) {
    // Words move with their parts; Merge joins two words that have no parts.
    const next = groupEnd(entries, index);
    const canMerge = !hasParts && next < entries.length && groupEnd(entries, next) === next + 1;
    actions.push(
      button('up', index, '↑', { disabled: index === 0, 'aria-label': 'Move up' }),
      button('down', index, '↓', { disabled: next >= entries.length, 'aria-label': 'Move down' }),
      button('merge', index, 'Merge ↓', { disabled: !canMerge, 'aria-label': 'Merge with next word' }));
  }
  if (canSplit(entries, index)) actions.push(button('split', index, 'Split', { 'aria-label': 'List its characters under it' }));
  if (hasParts) actions.push(button('unsplit', index, 'Unsplit', { 'aria-label': 'Remove the lines under it' }));
  if (entry.again) actions.push(button('once', index, 'Print once'));
  actions.push(button('delete', index, 'Delete'));
  item.append(el('div', { class: 'actions' }, ...actions));
  return item;
}

function render() {
  $('list-name').value = list.name;
  const repeats = repeatFlags(list.entries);
  $('list').replaceChildren(...list.entries.map((entry, i) => wordRow(entry, i, repeats[i])));
  $('empty').hidden = list.entries.length > 0;
  const notices = [...list.notices];
  const greyed = repeats.filter(Boolean).length;
  if (greyed) {
    notices.push(`${greyed} repeat(s) in grey: a word is printed only the first time it appears. ` +
      'Press “Print again” to print one anyway.');
  }
  $('notices').replaceChildren(...notices.map(text => el('p', { class: 'notice' }, text)));
  renderSheetTab();
}

function renderSheetTab() {
  const practice = settings.sheetType === 'practice';
  for (const radio of document.querySelectorAll('input[name="sheet-type"]')) {
    radio.checked = radio.value === settings.sheetType;
  }
  for (const radio of document.querySelectorAll('input[name="box-size"]')) {
    radio.checked = radio.value === settings.boxSize;
  }
  for (const radio of document.querySelectorAll('input[name="practice-box"]')) {
    radio.checked = Number(radio.value) === settings.practiceBox;
  }
  $('grid-options').hidden = practice;
  $('practice-options').hidden = !practice;
  const examples = printedEntries(list.entries).filter(entry => entry.example).length;
  $('example-note').textContent = examples && (practice || settings.boxSize !== 'large')
    ? `${examples} word(s) have an example sentence: it is printed only on the grid sheet with large boxes.` : '';
  $('default-rows').value = settings.defaultRows;
  $('default-rows').max = SIZES[settings.boxSize].maxRows;
  $('rounds').value = settings.rounds;
  renderMissing();

  const summary = $('sheet-summary');
  const errors = errorCount();
  if (!list.entries.length) {
    summary.textContent = 'The list is empty. Add words on tab 1 first.';
  } else if (errors) {
    summary.textContent = `${errors} word(s) have a red error. Fix them on tab 1 before making the PDF.`;
  } else {
    const items = sheetItems();
    const pages = practice
      ? layoutPractice(items, practiceOptions(1)).pages.length
      : layoutSheet(items, settings.boxSize).pages.length;
    summary.textContent = `“${list.name || 'Untitled'}”: ${items.length} word(s) on ${pages} page(s).`;
  }
  $('make-pdf').disabled = !list.entries.length || errors > 0;
}

// Practice sheet: say which words have no pinyin or no meaning (they still print).
function renderMissing() {
  const box = $('missing');
  box.replaceChildren();
  if (settings.sheetType !== 'practice') return;
  const printed = printedEntries(list.entries);
  const noPinyin = printed.filter(entry => !entry.pinyin).map(entry => entry.word);
  const noMeaning = printed.filter(entry => !entry.meaning).map(entry => entry.word);
  if (noPinyin.length) box.append(el('p', { class: 'notice' }, `No pinyin (${noPinyin.length}): ${noPinyin.join(', ')}`));
  if (noMeaning.length) box.append(el('p', { class: 'notice' }, `No meaning (${noMeaning.length}): ${noMeaning.join(', ')}`));
  if (noPinyin.length || noMeaning.length) {
    box.append(el('p', { class: 'hint' }, 'These words still print; the missing parts are left empty. Add them with Edit on tab 1.'));
  }
}

// seed: a number that decides the random order of the mixed rounds.
function practiceOptions(seed) {
  return { box: settings.practiceBox, rounds: settings.rounds, seed, name: list.name || '' };
}

// What goes on the sheet: every printed entry (not the repeats), with "nǐ → ní" pinyin.
function sheetItems() {
  return printedEntries(list.entries).map(entry => ({
    word: entry.word, pinyin: pinyinText(entry), meaning: entry.meaning, rows: entry.rows,
    example: entry.example || '', examplePinyin: entry.examplePinyin || '', exampleMeaning: entry.exampleMeaning || '',
  }));
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

// A reply that cannot be used: only the prompt's example, an unfinished answer, or "nothing to
// copy". Returns the message to show, or ''.
function unusable(result, which) {
  if (result.nothing && !result.entries.length) return `${which}: the AI found nothing to copy (${result.nothing}).`;
  if (result.echoedExample) return `${which} only repeats the example from the prompt. Paste the AI’s real answer.`;
  if (result.continueFrom !== null && result.continueFrom !== undefined) {
    return `${which} is not finished: the AI stopped before page ${result.continueFrom}. In the AI chat, type ` +
      '“continue”. Then paste the next part at the end of the same box, under the first part, and press ' +
      '“Read text” again.';
  }
  return '';
}

function useResult(result, second = null) {
  const problem = unusable(result, 'This reply') || (second && unusable(second, 'The second reply'));
  if (problem) {
    showMessage(problem, 'problem');
    return;
  }
  let entries = result.entries;
  const notices = [];
  if (second) {
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
  // A reply to "Copy AI prompt: pinyin & meaning" or "… example sentences" (lines without page
  // numbers): every pasted line with pinyin, a meaning or an example sentence is a word already
  // in the list, so it fills in what is missing instead of replacing the list. An answer with
  // page numbers is always a new list.
  if (!second && (isPinyinPromptExample(entries, list.entries) || isExamplePromptExample(entries, list.entries))) {
    showMessage('This reply only repeats the example from the prompt. Paste the AI\u2019s real answer.', 'problem');
    return;
  }
  const filling = !second && !result.isReply && allInList(list.entries, entries);
  // Example sentences longer than 12 boxes are not taken in: they would not fit on their line.
  // The word stays without one, so the example sentences prompt asks for it again.
  const long = dropLongExamples(entries);
  entries = long.entries;
  const longNote = long.dropped.length
    ? ` ${long.dropped.length} example sentence(s) had more than ${EXAMPLE_MAX_BOXES} boxes and were not added ` +
      `(${long.dropped.join(', ')}): press \u201cCopy AI prompt: example sentences\u201d again to get new ones.`
    : '';
  if (filling) {
    const filled = fillIn(list.entries, entries);
    if (!filled.updated) {
      if (long.dropped.length) {
        showMessage(`Nothing was added.${longNote}`, 'problem');
      } else {
        showMessage('Nothing to fill in: these words are already in your list with their pinyin, meaning and ' +
          'example sentence. (To read this text as a new list instead, press “Clear list” first.)', 'ok');
      }
      return;
    }
    list.entries = filled.entries;
    list.notices = list.notices.filter(notice => !notice.startsWith('Split '));
    editing = -1;
    const done = [];
    if (filled.filled) done.push(`Filled in the pinyin and meaning of ${filled.filled} word(s) in your list.`);
    if (filled.examples) done.push(`Added an example sentence to ${filled.examples} word(s) in your list.`);
    if (filled.completed) done.push(`Added the missing pinyin or English to ${filled.completed} example sentence(s).`);
    showMessage(`${done.join(' ')}${longNote} (To start a new list instead, press “Clear list” first.)`, 'ok');
    listChanged();
    return;
  }
  if (list.entries.length && !window.confirm(`Replace the current list (${list.entries.length} words)?`)) return;
  if (result.removed) notices.push(`${result.removed} repeated word(s) were removed.`);
  if (result.total !== null && result.total !== undefined && result.total !== result.lines) {
    notices.push(`The AI wrote “total: ${result.total}” but the reply has ${result.lines} word line(s). A word may be missing.`);
  }
  list = {
    name: result.name,
    entries: entries.map(entry => ({ ...entry, splitFrom: '', again: false, rows: settings.defaultRows })),
    notices,
  };
  editing = -1;
  const words = entries.filter(entry => !(entry.depth > 0)).length;
  const parts = entries.length - words;
  showMessage(`Read ${words} word(s)${parts ? ` with ${parts} line(s) under them` : ''}.${longNote}`, 'ok');
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

// Copies text to the clipboard. Called directly inside the tap, with the text already
// loaded (iPhone needs both). If copying is not allowed, the text is shown in a box instead.
function copyText(text, onCopied) {
  const fallback = () => {
    $('prompt-text').value = text;
    $('prompt-box').hidden = false;
    $('prompt-box').scrollIntoView({ block: 'nearest' });
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onCopied, fallback);
  } else {
    fallback();
  }
}

// The two prompts for worksheets: words with their characters, or sentences with their chunks.
function copyPrompt(text) {
  if (!text) {
    showMessage('The prompt is not loaded yet. Try again in a moment.', 'problem');
    return;
  }
  copyText(text,
    () => showMessage('AI prompt copied. Paste it into ChatGPT, Gemini or Claude with your worksheet.', 'ok'));
}

// The prompt that asks an AI for the pinyin and meaning of the words that need them
// (split characters, words without pinyin or meaning), with those words added at the end.
function copyPinyinPrompt() {
  if (!pinyinPromptText) {
    listMessage('The prompt is not loaded yet. Try again in a moment.', 'problem');
    return;
  }
  const text = pinyinPrompt(pinyinPromptText, list.entries);
  if (!text) {
    listMessage('Every word already has its own pinyin and meaning.', 'ok');
    return;
  }
  copyText(text, () => listMessage(
    'Prompt copied, with the words that need pinyin or a meaning. Paste it into an AI chat, then paste ' +
    'the AI\u2019s reply into the box at the top and press \u201cRead text\u201d: it fills in your list.', 'ok'));
}

// The prompt that asks an AI for one example sentence per word at the chosen HSK level, with
// the words that have none yet added at the end.
function copyExamplePrompt() {
  if (!examplePromptText) {
    listMessage('The prompt is not loaded yet. Try again in a moment.', 'problem');
    return;
  }
  const text = examplePrompt(examplePromptText, list.entries, settings.exampleLevel);
  if (!text) {
    const words = list.entries.some(entry => !(entry.depth > 0) && !isSentence(entry.word));
    listMessage(!list.entries.length ? 'The list is empty.'
      : words ? 'Every word already has an example sentence.'
      : 'There is no word to ask about: sentences (and the lines under them) get no example sentence.', 'ok');
    return;
  }
  copyText(text, () => listMessage(
    `Prompt copied (HSK ${settings.exampleLevel}), with the words that have no example sentence yet. Paste it into ` +
    'an AI chat, then paste the AI\u2019s reply into the box at the top and press \u201cRead text\u201d: it fills in your list.', 'ok'));
}

// ---------------------------------------------------------------------------------------
// Changing the list
// ---------------------------------------------------------------------------------------

function onListClick(event) {
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const index = Number(target.dataset.index);
  const entries = list.entries;
  switch (target.dataset.action) {
    case 'rows': {
      const value = target.dataset.rows;
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
      list.entries = moveEntry(entries, index, -1);
      editing = -1;
      break;
    case 'down':
      list.entries = moveEntry(entries, index, 1);
      editing = -1;
      break;
    case 'delete':
      list.entries = deleteEntry(entries, index);
      editing = -1;
      break;
    case 'merge': {
      const [first, next] = [entries[index], entries[index + 1]];
      if (!next || (next.depth || 0) !== 0) break;
      entries.splice(index, 2, {
        ...first,
        word: first.word + next.word,
        pinyin: [first.pinyin, next.pinyin].filter(Boolean).join(' '),
        said: '',
        meaning: [first.meaning, next.meaning].filter(Boolean).join('; '),
        unsure: first.unsure || next.unsure,
        splitFrom: '',
        // Neither sentence is about the joined word.
        example: '', examplePinyin: '', exampleMeaning: '', exampleUnsure: false,
      });
      editing = -1;
      break;
    }
    case 'split': {
      const result = splitEntries(entries, index);
      list.entries = result.entries;
      addSplitNotice(result);
      editing = -1;
      break;
    }
    case 'unsplit':
      list.entries = unsplit(entries, index);
      editing = -1;
      break;
    case 'again':
      entries[index].again = true;
      break;
    case 'once':
      entries[index].again = false;
      break;
    default:
      return;
  }
  listChanged();
}

function onListChange(event) {
  const input = event.target;
  if (input.dataset.action !== 'rows-number') return;
  const index = Number(input.dataset.index);
  const entry = list.entries[index];
  const max = emptyRows('Page', settings.boxSize, modelLines(entry.word, settings.boxSize), exampleRows(entry, settings.boxSize));
  let n = Math.floor(Number(input.value));
  if (!Number.isFinite(n) || n < 0) n = 0;
  list.entries[index].rows = n >= max ? 'Page' : n;
  listChanged();
}

// "Split all": every word with two or more characters (and every chunk of a sentence) gets
// its characters listed under it.
function splitAll() {
  const repeats = repeatFlags(list.entries);
  const count = list.entries.filter((_, i) => !repeats[i] && canSplit(list.entries, i)).length;
  if (!count) {
    listMessage('There is nothing to split: every word has one character or its lines under it already.', 'problem');
    return;
  }
  if (!window.confirm(`Split all ${count} word(s)? Each one stays, with its characters listed under it.`)) return;
  const result = splitEntries(list.entries);
  list.entries = result.entries;
  addSplitNotice(result);
  editing = -1;
  listMessage('');
  listChanged();
}

function addSplitNotice({ split }) {
  const text = `Split ${split} word(s): their characters are listed under them. Pinyin taken from a word ` +
    'needs checking and meanings may be empty: \u201cCopy AI prompt: pinyin & meaning\u201d fills them in.';
  list.notices = [...list.notices.filter(notice => !notice.startsWith('Split ')), text];
}

function onEditSubmit(event) {
  const form = event.target.closest('.edit-form');
  if (!form) return;
  event.preventDefault();
  const index = Number(form.dataset.index);
  // A problem is shown inside the form, next to the fields (the top of the page may be far away).
  const problem = text => { form.querySelector('.form-message').textContent = text; };
  const word = boxText(form.elements.word.value);
  if (!word) {
    problem('A word needs at least one Chinese character.');
    return;
  }
  const typed = form.elements.example.value.trim();
  const example = boxText(typed);
  if (typed && !example) {
    problem('An example sentence needs Chinese characters. To have none, leave the box empty.');
    return;
  }
  if ([...example].length > EXAMPLE_MAX_BOXES) {
    problem(`The example sentence has ${[...example].length} boxes; at most ${EXAMPLE_MAX_BOXES} fit on its line. ` +
      'Shorten it, or empty the box and use \u201cCopy AI prompt: example sentences\u201d.');
    return;
  }
  // A changed word no longer matches its lines under it: they go (Split makes new ones).
  if (word !== list.entries[index].word) list.entries = unsplit(list.entries, index);
  const { pinyin, said } = splitArrow(form.elements.pinyin.value.trim());
  const oneLine = text => text.replace(/\s+/g, ' ').trim();
  Object.assign(list.entries[index], {
    word,
    pinyin,
    said,
    meaning: form.elements.meaning.value.trim(),
    unsure: false,
    splitFrom: '',   // the owner has checked the pinyin
    example,
    examplePinyin: example ? oneLine(form.elements.examplePinyin.value) : '',
    exampleMeaning: example ? oneLine(form.elements.exampleMeaning.value) : '',
    exampleUnsure: false,
  });
  editing = -1;
  listChanged();
}

function addWord(event) {
  event.preventDefault();
  const word = boxText($('add-word').value);
  if (!word) {
    showMessage('Type or paste a word with Chinese characters.', 'problem');
    return;
  }
  list.entries.push({
    word, pinyin: '', said: '', meaning: '', page: null, unsure: false, compare: null, other: '', depth: 0,
    splitFrom: '', again: false, rows: settings.defaultRows,
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
  pdfKind = settings.sheetType;
  startWorker().postMessage({
    items: sheetItems(),
    sheetType: settings.sheetType,
    boxSize: settings.boxSize,
    // A new random order of the mixed rounds every time the PDF is made.
    practice: practiceOptions(Math.floor(Math.random() * 2 ** 32)),
    title: list.name || 'Untitled',
  });
}

function savePdf() {
  if (!pdfBlob) return;
  const name = `${safeFileName(list.name || 'Untitled')}_${pdfKind === 'practice' ? 'practice' : 'grid'}.pdf`;
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
  const [commonText, fontText, prompt, sentencePrompt, pinyinPromptFile, examplePromptFile] = await Promise.all([
    loadText('data/common3500.txt'),
    loadText('data/font-chars.txt'),
    loadText('prompts/worksheet.txt'),
    loadText('prompts/sentences.txt'),
    loadText('prompts/pinyin-meaning.txt'),
    loadText('prompts/examples.txt'),
  ]);
  common = new Set(lines(commonText));
  fontChars = new Set(lines(fontText));
  promptText = prompt;
  sentencePromptText = sentencePrompt;
  pinyinPromptText = pinyinPromptFile;
  examplePromptText = examplePromptFile;
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
  $('copy-prompt').addEventListener('click', () => copyPrompt(promptText));
  $('copy-sentence-prompt').addEventListener('click', () => copyPrompt(sentencePromptText));
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
  $('split-all').addEventListener('click', splitAll);
  $('copy-pinyin-prompt').addEventListener('click', copyPinyinPrompt);
  $('copy-example-prompt').addEventListener('click', copyExamplePrompt);
  $('example-level').value = String(settings.exampleLevel);
  $('example-level').addEventListener('change', () => {
    settings.exampleLevel = Number($('example-level').value) || 1;
    saveSettings(settings);
  });
  $('clear-list').addEventListener('click', () => {
    if (list.entries.length && !window.confirm('Remove all words from the list?')) return;
    list = { name: '', entries: [], notices: [] };
    listChanged();
  });
  for (const radio of document.querySelectorAll('input[name="box-size"]')) {
    radio.addEventListener('change', () => setBoxSize(radio.value));
  }
  for (const radio of document.querySelectorAll('input[name="sheet-type"]')) {
    radio.addEventListener('change', () => {
      settings.sheetType = radio.value;
      saveSettings(settings);
      listChanged();
    });
  }
  for (const radio of document.querySelectorAll('input[name="practice-box"]')) {
    radio.addEventListener('change', () => {
      settings.practiceBox = Number(radio.value);
      saveSettings(settings);
      listChanged();
    });
  }
  $('rounds').addEventListener('change', () => {
    let n = Math.floor(Number($('rounds').value));
    if (!Number.isFinite(n)) n = 3;
    settings.rounds = Math.min(5, Math.max(1, n));
    saveSettings(settings);
    listChanged();
  });
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
