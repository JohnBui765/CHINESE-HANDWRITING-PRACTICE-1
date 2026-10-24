// The practice sheet: where everything goes on the pages (no browser APIs, no PDF library).
//
//   Part 1  Model list   number · the word in KaiTi boxes · pinyin · "- meaning"
//   Part 2  Side B only  number · empty boxes · pinyin · "- meaning"   (write the word)
//   Part 3  Mixed        rounds of all words in a new random order. Each item shows EITHER
//                        the word (write pinyin and meaning on the line) OR the pinyin and
//                        meaning (write the word in the empty boxes).
//
// Measured from HSK1_Bai3-4_practice_kai.pdf (14 mm boxes). y = mm from the page top.
// The result has the same shape as layout.js, so draw.js draws both.

import { MM, PAGE_HEIGHT } from './layout.js';

export const PRACTICE_BOXES = [14, 12, 10];   // box sizes in mm; 14 mm is the sample's

const LEFT = 25;              // left edge of the boxes
const RIGHT = 195;            // right end of the answer lines
const BOTTOM = 271.5;         // a box may end at most this far down
const FIRST_ROW = 19.5;       // first box on a page without a title
const TITLE_Y = 24;           // part title baseline
const SUBTITLE_Y = 30;        // part subtitle baseline
const TEXT_TO_ROW = 6.5;      // title / subtitle / round heading baseline -> next box top
const SUBTITLE_TO_HEADING = 11;
const ROW_TO_HEADING = 7.5;   // a box bottom -> the round heading below it
const NUMBER_RIGHT = 23;      // item numbers end here

const BLACK = '#000000';
const GREY = '#666666';

// Box size 14 mm keeps the sample exactly; smaller boxes scale the in-row distances and the
// pinyin/meaning text with them (never below a readable size).
function sizes(boxMm) {
  const s = boxMm / 14;
  return {
    box: boxMm,
    pitch: boxMm + 3,                          // 17 mm between rows for 14 mm boxes
    numberY: 8.5 * s,                          // baselines measured from the box top
    textY: 8 * s,
    lineY: 12 * s,                             // the answer line
    pinyinSize: Math.max(10, 13 * s),
    meaningSize: Math.max(8, 10.5 * s),
    meaningGap: 30 * s,                        // pinyin x -> meaning x
  };
}

// The longest word a practice row can hold: the pinyin must start by x = 125 mm.
export function maxPracticeChars(boxMm) {
  return Math.floor((125 - LEFT - 6) / boxMm);
}

// A small random number generator that gives the same numbers for the same seed, so a
// test can check one exact order. (Math.random() cannot be given a seed.)
function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Part 3: for every round, the order of the words and what each item shows
// ("word" = the word is shown, "sideB" = pinyin and meaning are shown).
// Round 1 shows the word for a random half; round 2 swaps every word; round 3 is random
// again, round 4 swaps it, and so on. A word with neither pinyin nor meaning has nothing to
// show on side B, so it always shows the word.
export function practiceRounds(items, rounds, seed) {
  const random = randomFrom(seed);
  const hasSideB = items.map(item => Boolean(item.pinyin || item.meaning));
  const all = items.map((_, i) => i);
  const result = [];
  let shows = null;
  for (let r = 0; r < rounds; r++) {
    if (r % 2 === 0) {
      const eligible = shuffle(all.filter(i => hasSideB[i]), random);
      const wordHalf = new Set(eligible.slice(0, Math.floor(eligible.length / 2)));
      shows = all.map(i => (!hasSideB[i] || wordHalf.has(i) ? 'word' : 'sideB'));
    } else {
      shows = shows.map((show, i) => (!hasSideB[i] ? 'word' : show === 'word' ? 'sideB' : 'word'));
    }
    const order = shuffle(all, random);
    // Don't start a round with the word that ended the round before it.
    const previous = result[result.length - 1];
    if (previous && order.length > 1 && order[0] === previous.at(-1).index) {
      [order[0], order[1]] = [order[1], order[0]];
    }
    result.push(order.map(index => ({ index, show: shows[index] })));
  }
  return result;
}

// items = [{ word, pinyin, meaning }], options = { box: 14 | 12 | 10, rounds: 1-5, seed, name }
export function layoutPractice(items, options = {}) {
  const box = PRACTICE_BOXES.includes(options.box) ? options.box : 14;
  const rounds = Math.min(5, Math.max(1, Math.floor(options.rounds || 3)));
  const seed = options.seed ?? 1;
  const name = options.name || '';
  const z = sizes(box);
  const maxChars = maxPracticeChars(box);
  for (const item of items) {
    const length = [...item.word].length;
    if (length === 0) throw new Error('A word is empty.');
    if (length > maxChars) {
      throw new Error(`"${item.word}" has ${length} characters; a practice row with ${box} mm boxes holds ${maxChars}.`);
    }
  }

  const y = mm => PAGE_HEIGHT - mm * MM;      // mm from the top -> PDF points from the bottom
  const x = mm => mm * MM;
  const pages = [];
  let page = null;
  let nextTop = FIRST_ROW;     // top of the next box
  let lastText = null;         // baseline of the title/heading just placed, if nothing came after it
  let lastBottom = null;       // bottom of the last box on this page

  function newPage() {
    page = { crosses: [], chars: [], grid: [], marks: [], texts: [] };
    pages.push(page);
    nextTop = FIRST_ROW;
    lastText = null;
    lastBottom = null;
  }

  function text(textValue, xMm, yMm, size, extra = {}) {
    page.texts.push({ text: textValue, font: 'print', size, color: BLACK, align: 'left', x: x(xMm), y: y(yMm), ...extra });
  }

  function startPart(title, subtitle) {
    newPage();
    text(title, 15, TITLE_Y, 14, { maxWidth: x(120) });
    if (name) text(name, RIGHT, TITLE_Y, 9, { align: 'right', color: GREY, maxWidth: x(55) });
    lastText = TITLE_Y;
    if (subtitle) {
      text(subtitle, 15, SUBTITLE_Y, 9, { maxWidth: x(RIGHT - 15) });
      lastText = SUBTITLE_Y;
    }
    nextTop = lastText + TEXT_TO_ROW;
  }

  function roundHeading(label) {
    let baseline;
    if (lastText !== null) baseline = lastText + SUBTITLE_TO_HEADING;
    else if (lastBottom !== null) baseline = lastBottom + ROW_TO_HEADING;
    else baseline = TITLE_Y;
    // The heading needs room for itself and at least one row under it.
    if (baseline + TEXT_TO_ROW + z.box > BOTTOM) {
      newPage();
      baseline = TITLE_Y;
    }
    text(label, 15, baseline, 14);
    lastText = baseline;
    nextTop = baseline + TEXT_TO_ROW;
  }

  // One row: number, boxes (with or without the word), and side B or an answer line.
  function row(number, item, showWord, showSideB) {
    if (nextTop + z.box > BOTTOM) newPage();
    const top = nextTop;
    const chars = [...item.word];
    const k = chars.length;
    const boxLeft = LEFT;
    const boxRight = LEFT + k * box;

    text(`${number}.`, NUMBER_RIGHT, top + z.numberY, 10, { align: 'right' });

    // Boxes: outline and dashed centre cross in every box.
    page.grid.push({ x1: x(boxLeft), y1: y(top), x2: x(boxRight), y2: y(top) });
    page.grid.push({ x1: x(boxLeft), y1: y(top + box), x2: x(boxRight), y2: y(top + box) });
    for (let c = 0; c <= k; c++) {
      const bx = boxLeft + c * box;
      page.grid.push({ x1: x(bx), y1: y(top), x2: x(bx), y2: y(top + box) });
    }
    for (let c = 0; c < k; c++) {
      const cx = boxLeft + c * box + box / 2;
      page.crosses.push({ x1: x(boxLeft + c * box), y1: y(top + box / 2), x2: x(boxLeft + (c + 1) * box), y2: y(top + box / 2) });
      page.crosses.push({ x1: x(cx), y1: y(top), x2: x(cx), y2: y(top + box) });
      if (showWord) page.chars.push({ ch: chars[c], font: 'kai', cx: x(cx), cy: y(top + box / 2) });
    }

    // Side B starts after the boxes (never before the third box, as in the sample).
    const pinyinX = LEFT + Math.max(3, k) * box + 6;
    const meaningX = pinyinX + z.meaningGap;
    if (showSideB) {
      if (item.pinyin) text(item.pinyin, pinyinX, top + z.textY, z.pinyinSize, { maxWidth: x(z.meaningGap - 2) });
      if (item.meaning) text(`- ${item.meaning}`, meaningX, top + z.textY, z.meaningSize, { maxWidth: x(RIGHT - meaningX) });
    } else {
      page.marks.push({ x1: x(pinyinX), y1: y(top + z.lineY), x2: x(RIGHT), y2: y(top + z.lineY), kind: 'answer' });
    }

    lastText = null;
    lastBottom = top + box;
    nextTop = top + z.pitch;
  }

  if (items.length) {
    startPart('PART 1: MODEL LIST (Side A: Side B)', '');
    items.forEach((item, i) => row(i + 1, item, true, true));

    startPart('PART 2: SIDE B ONLY', 'Write the character in the boxes.');
    items.forEach((item, i) => row(i + 1, item, false, true));

    startPart(`PART 3: MIXED PRACTICE (${rounds * items.length})`,
      'Character shown: write the pinyin and meaning on the line. Pinyin shown: write the character in the boxes.');
    let number = 1;
    practiceRounds(items, rounds, seed).forEach((round, r) => {
      roundHeading(`Round ${r + 1}`);
      for (const { index, show } of round) {
        row(number++, items[index], show === 'word', show === 'sideB');
      }
    });
  }

  return {
    boxSize: 'practice',
    style: {
      box: box * MM,
      grid: { color: '#000d33', width: 0.8 },
      cross: { color: '#000d33', width: 0.4, dash: [2, 2] },
      answer: { color: '#000888', width: 0.5 },
    },
    pages,
  };
}
