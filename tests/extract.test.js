// Tests for js/extract.js. Run with:  node --test tests/extract.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readText,
  isReply,
  readReply,
  compareReplies,
  countSyllables,
  toLessonText,
  safeFileName,
} from '../js/extract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const readFixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const words = result => result.entries.map(e => e.word);

describe('plain text', () => {
  test('mixed Chinese, pinyin, Vietnamese, English and numbers give only the Chinese words', () => {
    const text = [
      'Bài 3: 我是中国人 (wǒ shì Zhōngguó rén) – Tôi là người Trung Quốc. I am Chinese.',
      'Từ mới 1: 女朋友 nǚ péngyou, bạn gái; 2. 哪 nǎ (which) 2024 国 guó',
      '女朋友 again! 中国人 123 我是中国人, 你好，再见。',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(words(result), ['我是中国人', '女朋友', '哪', '国', '中国人', '你好', '再见']);
    assert.equal(result.removed, 2);
    assert.equal(result.lines, 9);
    assert.equal(result.name, 'Untitled');
    assert.equal(result.isReply, false);
    assert.equal(result.total, null);
    assert.equal(result.echoedExample, false);
    for (const entry of result.entries) {
      assert.deepEqual(
        { pinyin: entry.pinyin, meaning: entry.meaning, page: entry.page, unsure: entry.unsure },
        { pinyin: '', meaning: '', page: null, unsure: false },
      );
      assert.equal(entry.compare, null);
      assert.equal(entry.other, '');
    }
  });

  test('words are never split, and the same character may be in several words', () => {
    assert.deepEqual(words(readText('中国 中文 国 中国')), ['中国', '中文', '国']);
  });

  test('Extension A characters are kept; other scripts separate words', () => {
    assert.deepEqual(words(readText('\u3400好 abc 好')), ['\u3400好', '好']);
  });

  test('Kangxi radical code points become normal characters (NFKC)', () => {
    // U+2F25 ⼥ -> 女, U+2F08 ⼈ -> 人, U+2F1D ⼝ -> 口, U+2F49 ⽉ -> 月
    const result = readText('\u2F25朋友 \u2F08 \u2F1D \u2F49亮');
    assert.deepEqual(words(result), ['女朋友', '人', '口', '月亮']);
    assert.equal(result.entries[0].word.codePointAt(0), 0x5973);
  });

  test('empty text gives an empty list', () => {
    const result = readText('');
    assert.deepEqual(result, {
      name: 'Untitled',
      entries: [],
      removed: 0,
      isReply: false,
      lines: 0,
      total: null,
      echoedExample: false,
    });
  });
});

describe('lesson format', () => {
  test('with pinyin and meaning columns', () => {
    const result = readText(readFixture('lesson_columns.txt'), 'lesson_columns');
    assert.equal(result.name, 'Bài 5');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning]),
      [
        ['女朋友', 'nǚ péngyou', 'girlfriend'],
        ['哪', 'nǎ', 'which'],
        ['国', 'guó', ''],
        ['她', '', 'she'],
        ['喂', '', ''],
      ],
    );
    assert.equal(result.removed, 1);
    assert.equal(result.isReply, false);
  });

  test('without columns', () => {
    const result = readText(readFixture('lesson_plain.txt'), 'lesson_plain');
    assert.equal(result.name, 'Bài 5');
    assert.deepEqual(words(result), ['女朋友', '哪', '国']);
  });

  test('the word column is all its Chinese characters joined', () => {
    const result = readText('妈 妈 | mā ma | mum\n- 姐姐 | jiě jie');
    assert.deepEqual(words(result), ['妈妈', '姐姐']);
    assert.equal(result.entries[1].pinyin, 'jiě jie');
  });

  test('a repeat fills in a pinyin or meaning the first line lacks', () => {
    const result = readText('国\n国 | guó | country');
    assert.deepEqual(result.entries.map(e => [e.word, e.pinyin, e.meaning]), [['国', 'guó', 'country']]);
    assert.equal(result.removed, 1);
  });
});

describe('list name', () => {
  test('the "#" line', () => {
    assert.equal(readText('# Bài 5\n女').name, 'Bài 5');
    assert.equal(readText('## Bài 5\n女').name, 'Bài 5'); // Markdown heading
    assert.equal(readText('＃ Bài 5\n女').name, 'Bài 5'); // full-width #
  });

  test('several lessons give "Bài 3–4" with an en dash', () => {
    assert.equal(readText('# Bài 3\n女\n# Bài 4\n有').name, 'Bài 3\u20134');
    assert.equal(readText('# Bài 3 我是中国人\n女\n# Bài 4 我有两个孩子\n有').name, 'Bài 3–4');
    assert.equal(readText('# Bài 3\n# Bài 4\n# Bài 5').name, 'Bài 3–5');
    assert.equal(readText('# HSK1 Bài 3\n# HSK1 Bài 4').name, 'HSK1 Bài 3–4');
    assert.equal(readText('# Bài 3\n女\n# Bài 3\n有').name, 'Bài 3'); // same name twice
  });

  test('different names give "first–last"', () => {
    assert.equal(readText('# Review\n女\n# Bài 4\n有').name, 'Review–Bài 4');
  });

  test('no "#" line: the file name, or "Untitled"', () => {
    assert.equal(readText('女朋友', 'My lesson').name, 'My lesson');
    assert.equal(readText('女朋友').name, 'Untitled');
    assert.equal(readText('女朋友', '   ').name, 'Untitled');
  });

  test('"# total:" is not a list name', () => {
    const result = readText('女\n# total: 1', 'file');
    assert.equal(result.name, 'file');
    assert.equal(result.total, 1);
  });

  test('words on "#" lines are not words of the list', () => {
    assert.deepEqual(words(readText('# Bài 3 我是中国人\n女朋友')), ['女朋友']);
  });
});

describe('AI reply', () => {
  const reply = [
    '# Bài 3',
    '1 | 女朋友 | nǚ péng you | girlfriend',
    '1 | 哪 | nǎ | which',
    '2 | 国 | guó | country ?',
    '# total: 3',
  ].join('\n');

  test('isReply: a line that looks like "number | ..."', () => {
    assert.equal(isReply(reply), true);
    assert.equal(isReply('1 ｜ 女朋友'), true); // full-width pipe
    assert.equal(isReply('| 1 | 女朋友 | nǚ |'), true); // Markdown table
    assert.equal(isReply('1. 3 | 女朋友'), true); // numbering in front
    assert.equal(isReply('女朋友 | nǚ péngyou'), false); // lesson format
    assert.equal(isReply('女朋友\n哪'), false);
    assert.equal(isReply('10 | 20'), false); // no Chinese word
  });

  test('a plain reply', () => {
    const result = readText(reply, 'pasted');
    assert.equal(result.isReply, true);
    assert.equal(result.name, 'Bài 3');
    assert.equal(result.total, 3);
    assert.equal(result.lines, 3);
    assert.equal(result.echoedExample, false);
    assert.deepEqual(result.entries[0], {
      word: '女朋友',
      pinyin: 'nǚ péng you',
      meaning: 'girlfriend',
      page: 1,
      unsure: false,
      compare: null,
      other: '',
    });
    assert.deepEqual(
      result.entries.map(e => [e.word, e.page, e.unsure, e.meaning]),
      [
        ['女朋友', 1, false, 'girlfriend'],
        ['哪', 1, false, 'which'],
        ['国', 2, true, 'country'],
      ],
    );
  });

  test('a fenced reply with text before and after it', () => {
    const text = [
      'Here is the vocabulary from Bài 3 (我是中国人):',
      '## Notes',
      '```text',
      reply,
      '```',
      'I was not sure about 国. Hope this helps! 加油',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(words(result), ['女朋友', '哪', '国']);
    assert.equal(result.name, 'Bài 3');
    assert.equal(result.total, 3);
  });

  test('text around the block without a fence', () => {
    const text = `Sure! Here it is.\n${reply}\nLet me know if you need anything else, 朋友.`;
    const result = readText(text);
    assert.deepEqual(words(result), ['女朋友', '哪', '国']);
  });

  test('full-width pipes and extra spaces', () => {
    const result = readText('  1  ｜  女朋友 ｜  nǚ   péng  you ｜ girl  friend  \n１ ｜ 哪 ｜ nǎ ｜ which');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning, e.page]),
      [
        ['女朋友', 'nǚ péng you', 'girl friend', 1],
        ['哪', 'nǎ', 'which', 1],
      ],
    );
  });

  test('no pinyin column, no meaning column, an empty pinyin column', () => {
    const result = readText('1 | 女朋友\n1 | 哪 | nǎ\n2 | 国 |  | country\n2 | 她 | - | she');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning]),
      [
        ['女朋友', '', ''],
        ['哪', 'nǎ', ''],
        ['国', '', 'country'],
        ['她', '', 'she'],
      ],
    );
  });

  test('numbering such as "1." and page labels', () => {
    const result = readText('1. 1 | 女朋友 | nǚ\n2) 3 | 哪 | nǎ\np4 | 国 | guó\nPage 5 | 她 | tā');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.page]),
      [
        ['女朋友', 1],
        ['哪', 3],
        ['国', 4],
        ['她', 5],
      ],
    );
  });

  test('the word column is one word, even with spaces in it', () => {
    const result = readText('8 | 妈 妈 | mā ma | mum');
    assert.deepEqual(words(result), ['妈妈']);
  });

  test('pinyin slashes as printed on the worksheet are removed', () => {
    assert.equal(readText('1 | 女朋友 | /nǚ péng you/ | girlfriend').entries[0].pinyin, 'nǚ péng you');
  });

  test('a Markdown table reply', () => {
    const text = [
      '| page | word | pinyin | meaning |',
      '|------|------|--------|---------|',
      '| 1 | 女朋友 | nǚ péng you | girlfriend |',
      '| 2 | 老师 | lǎo shī | teacher ? |',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning, e.unsure]),
      [
        ['女朋友', 'nǚ péng you', 'girlfriend', false],
        ['老师', 'lǎo shī', 'teacher', true],
      ],
    );
  });

  test('"?" flags', () => {
    const text = [
      '1 | 太 | tài | too ?',
      '1 | 对 | duì | right ？', // full-width question mark
      '1 | 想 ?', // no pinyin or meaning columns
      '1 | 家 | jiā | home | ?', // "?" in its own column
      '1 | 口 | kǒu | mouth??',
      '2 | 呢 | ne | how about...?', // part of the meaning, not a flag
      '2 | 和 | hé | and',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(
      result.entries.map(e => [e.word, e.unsure, e.meaning]),
      [
        ['太', true, 'too'],
        ['对', true, 'right'],
        ['想', true, ''],
        ['家', true, 'home'],
        ['口', false, 'mouth??'],
        ['呢', false, 'how about...?'],
        ['和', false, 'and'],
      ],
    );
  });

  test('a wrong total is reported as read', () => {
    const result = readText('1 | 女朋友\n1 | 哪\n# total: 5');
    assert.equal(result.total, 5);
    assert.equal(result.lines, 2);
  });

  test('no total line gives null; the last total line counts', () => {
    assert.equal(readText('1 | 女朋友').total, null);
    assert.equal(readText('1 | 女朋友\n# total: 1\n2 | 哪\n# Total 2').total, 2);
  });

  test('repeated words: counted, removed, and a "?" on any repeat is kept', () => {
    const result = readText('1 | 国 | guó | country\n4 | 国 | guó | country ?\n5 | 国 | guó');
    assert.deepEqual(words(result), ['国']);
    assert.equal(result.removed, 2);
    assert.equal(result.lines, 3);
    assert.equal(result.entries[0].unsure, true);
    assert.equal(result.entries[0].page, 1);
  });

  test('lines with no Chinese are skipped', () => {
    const result = readText('1 | 女朋友\n2 | ? | wèi | hello\n# total: 2');
    assert.deepEqual(words(result), ['女朋友']);
    assert.equal(result.lines, 1);
    assert.equal(result.total, 2);
  });

  test('two lessons in one reply', () => {
    const result = readText('# Bài 3\n1 | 女朋友\n# Bài 4\n6 | 有');
    assert.equal(result.name, 'Bài 3–4');
  });

  test('a reply with no "#" line uses the fallback name', () => {
    assert.equal(readReply('1 | 女朋友', 'worksheet').name, 'worksheet');
    assert.equal(readReply('1 | 女朋友').name, 'Untitled');
  });
});

describe('echoed format example', () => {
  const promptPath = path.join(ROOT, 'prompts', 'worksheet.txt');

  test('the whole prompt pasted back is detected', () => {
    const result = readText(fs.readFileSync(promptPath, 'utf8'));
    assert.equal(result.isReply, true);
    assert.equal(result.echoedExample, true);
    // This also checks that EXAMPLE_WORDS in extract.js matches the prompt's example.
    assert.deepEqual(words(result), ['学生', '他', '老师']);
  });

  test('the example block alone is detected', () => {
    const text = '```\n# Bài 9\n1 | 学生 | xué sheng | student\n1 | 他 | tā | he\n2 | 老师 | lǎo shī | teacher ?\n# total: 3\n```';
    assert.equal(readText(text).echoedExample, true);
  });

  test('a real reply is not flagged', () => {
    assert.equal(readText('1 | 女朋友\n1 | 他').echoedExample, false);
    assert.equal(readText('学生 他 老师').echoedExample, false); // plain text is never a reply
  });

  test('the example words are in neither sample', () => {
    const key = readFixture('sample_key.txt');
    for (const word of ['学生', '他', '老师']) {
      assert.equal(key.includes(word), false, word);
      for (const sampleWord of ['女朋友', '哪', '国', '她', '喂', '姐姐', '工作', '还', '忙', '吗']) {
        assert.equal(sampleWord.includes(word), false, word);
      }
    }
  });
});

describe('countSyllables', () => {
  const cases = [
    ['nǚ péngyou', 3],
    ['jiějie', 2],
    ["Xī'ān", 2],
    ['Xī’ān', 2], // typographic apostrophe
    ['Zhōng-guó', 2],
    ['ni3 hao3', 2],
    ['ni3hao3', 2],
    ['nv3', 1],
    ['nü3 peng2you5', 3],
    ['lü4', 1],
    ['XUÉ SHENG', 2],
    ['xiǎng', 1],
    ['gōng zuò', 2],
    ['', 0],
  ];
  for (const [pinyin, count] of cases) {
    test(`"${pinyin}" = ${count}`, () => assert.equal(countSyllables(pinyin), count));
  }
  test('null and undefined give 0', () => {
    assert.equal(countSyllables(null), 0);
    assert.equal(countSyllables(undefined), 0);
  });
});

describe('compareReplies', () => {
  const list = text => readText(text).entries;

  test('two equal replies: all "same"', () => {
    const result = compareReplies(list('1 | 女朋友\n1 | 哪'), list('1 | 女朋友\n1 | 哪'));
    assert.deepEqual(result.map(e => [e.word, e.compare, e.other]), [
      ['女朋友', 'same', ''],
      ['哪', 'same', ''],
    ]);
  });

  test('different words, and words only one reply has', () => {
    const a = list('1 | 女朋友\n1 | 哪\n1 | 国\n2 | 太\n3 | 和');
    const b = list('1 | 女朋友\n1 | 那\n1 | 国\n2 | 喂\n2 | 太\n3 | 和\n3 | 口');
    const result = compareReplies(a, b);
    assert.deepEqual(result.map(e => [e.word, e.compare, e.other]), [
      ['女朋友', 'same', ''],
      ['哪', 'differs', '那'],
      ['国', 'same', ''],
      ['喂', 'onlyB', ''],
      ['太', 'same', ''],
      ['和', 'same', ''],
      ['口', 'onlyB', ''],
    ]);
  });

  test('a word only the first reply has', () => {
    const result = compareReplies(list('1 | 女朋友\n1 | 哪\n1 | 国'), list('1 | 女朋友\n1 | 国'));
    assert.deepEqual(result.map(e => [e.word, e.compare]), [
      ['女朋友', 'same'],
      ['哪', 'onlyA'],
      ['国', 'same'],
    ]);
  });

  test('a gap with more words in A than in B', () => {
    const result = compareReplies(list('1 | 女\n1 | 甲\n1 | 乙\n1 | 国'), list('1 | 女\n1 | 丙\n1 | 国'));
    assert.deepEqual(result.map(e => [e.word, e.compare, e.other]), [
      ['女', 'same', ''],
      ['甲', 'differs', '丙'],
      ['乙', 'onlyA', ''],
      ['国', 'same', ''],
    ]);
  });

  test('B-only entries keep their own pinyin, meaning and page; inputs are not changed', () => {
    const a = list('1 | 女朋友 | nǚ péngyou');
    const b = list('1 | 女朋友 | nǚ péngyou\n2 | 哪 | nǎ | which ?');
    const result = compareReplies(a, b);
    assert.deepEqual(result[1], {
      word: '哪',
      pinyin: 'nǎ',
      meaning: 'which',
      page: 2,
      unsure: true,
      compare: 'onlyB',
      other: '',
    });
    assert.equal(a[0].compare, null);
  });

  test('empty lists', () => {
    assert.deepEqual(compareReplies([], []), []);
    assert.deepEqual(compareReplies(list('1 | 女'), []).map(e => e.compare), ['onlyA']);
    assert.deepEqual(compareReplies([], list('1 | 女')).map(e => e.compare), ['onlyB']);
  });
});

describe('toLessonText', () => {
  const entries = [
    { word: '女朋友', pinyin: 'nǚ péngyou', meaning: 'girlfriend', page: 1, unsure: true, compare: null, other: '' },
    { word: '哪', pinyin: 'nǎ', meaning: '', page: null, unsure: false, compare: null, other: '' },
    { word: '国', pinyin: '', meaning: 'country', page: null, unsure: false, compare: null, other: '' },
    { word: '她', pinyin: '', meaning: '', page: null, unsure: false, compare: null, other: '' },
  ];

  test('writes the lesson format', () => {
    assert.equal(
      toLessonText('Bài 5', entries),
      '# Bài 5\n女朋友 | nǚ péngyou | girlfriend\n哪 | nǎ\n国 |  | country\n她\n',
    );
  });

  test('round trip through readText', () => {
    const result = readText(toLessonText('Bài 3–4', entries), 'ignored');
    assert.equal(result.name, 'Bài 3–4');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning]),
      entries.map(e => [e.word, e.pinyin, e.meaning]),
    );
    assert.equal(result.removed, 0);
  });

  test('a "|" or a line break inside a column cannot break the format', () => {
    const tricky = [{ ...entries[0], meaning: 'girlfriend | lover\nsweetheart' }];
    const text = toLessonText('A\nB', tricky);
    assert.equal(text, '# A B\n女朋友 | nǚ péngyou | girlfriend / lover sweetheart\n');
    assert.equal(readText(text).entries[0].meaning, 'girlfriend / lover sweetheart');
  });

  test('an empty name becomes "Untitled"', () => {
    assert.equal(toLessonText('', []), '# Untitled\n');
  });
});

describe('safeFileName', () => {
  test('replaces characters Windows forbids', () => {
    assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.equal(safeFileName('tab\there'), 'tab_here');
  });
  test('keeps Vietnamese, Chinese and the en dash', () => {
    assert.equal(safeFileName('Bài 3–4 我是中国人'), 'Bài 3–4 我是中国人');
  });
  test('no trailing dots or spaces, never empty, no device names', () => {
    assert.equal(safeFileName('lesson. . '), 'lesson');
    assert.equal(safeFileName(''), 'Untitled');
    assert.equal(safeFileName('...'), 'Untitled');
    assert.equal(safeFileName('CON'), '_CON');
    assert.equal(safeFileName('com1.txt'), '_com1.txt');
  });
  test('long names are shortened', () => {
    assert.equal(safeFileName('字'.repeat(300)).length, 100);
  });
});

describe('Liao Laoshi worksheet: the AI route (DoD 3)', () => {
  const keyPath = path.join(FIXTURES, 'sample_key.txt');
  const replyPath = path.join(FIXTURES, 'claude_reply.txt');
  const missing = !fs.existsSync(keyPath) || !fs.existsSync(replyPath);

  test('the answer key reads as 30 words in two lessons', { skip: missing && 'answer key missing' }, () => {
    const key = readText(readFixture('sample_key.txt'));
    assert.equal(key.name, 'Bài 3–4');
    assert.equal(key.entries.length, 30);
    assert.equal(key.removed, 0);
    // Every pinyin in the key has one syllable per character.
    for (const entry of key.entries) {
      assert.equal(countSyllables(entry.pinyin), [...entry.word].length, entry.word);
    }
  });

  test("Claude's reply matches the answer key", { skip: missing && 'reply or key missing' }, () => {
    const key = readText(readFixture('sample_key.txt'));
    const reply = readText(readFixture('claude_reply.txt'));
    assert.equal(reply.isReply, true);
    assert.equal(reply.echoedExample, false);
    assert.equal(reply.name, 'Bài 3–4');
    assert.deepEqual(words(reply), words(key));
    assert.equal(reply.total, reply.lines);
    assert.equal(reply.removed, 0);
    const noSpaces = s => s.replace(/\s+/g, '').toLowerCase();
    assert.deepEqual(reply.entries.map(e => noSpaces(e.pinyin)), key.entries.map(e => noSpaces(e.pinyin)));
    // The pages: Bài 3 on pages 1-5, Bài 4 on pages 6-8, four boxes a page (two on page 5).
    assert.deepEqual(
      reply.entries.map(e => e.page),
      [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8],
    );
    const comparison = compareReplies(reply.entries, key.entries);
    assert.ok(comparison.every(e => e.compare === 'same'));
  });
});
