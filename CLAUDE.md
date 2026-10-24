# Hanzi Grid — offline Chinese handwriting practice sheets (PWA)

An offline web app (PWA) that turns a list of Chinese **words** into A4 writing-practice PDFs. For
every word the sheet shows the whole word in **KaiTi** (handwriting style), the same word in the
**print/screen** font directly below it, then as many empty 田字格 rows as the owner chooses for
that word. It runs in Chrome or Edge on Windows and in Safari on iPhone, and builds the PDF inside
the browser.

The owner is an HSK 1 beginner who cannot yet judge whether a character is correct, so the app
must make checking possible by **shape**, not by knowledge of Chinese.

The program has two parts:

1. **Get the list.** Turn a source into a checked list of words.
2. **Make the sheet.** Turn the list into the practice PDF. This is the main job and must be exact.

Reading **picture-only** worksheets is outsourced. The app gives the owner a prompt. The owner
pastes it, together with the worksheet, into an AI chat app (ChatGPT, Gemini, Claude) and pastes
the reply back into the app. **The app itself never calls an AI, an API or another website.**

## How to work with me (read first)

- **Never `git commit` or `git push`.** When a milestone is done, give me a zip of the project
  folder (without `.git`, `samples/`, `node_modules/`, `.venv/`, `__pycache__/`) and a short
  assessment: what works, what was tested, what is left.
- **Show a plan before writing code**, and again before any large change.
- I'm learning to program. Explain decisions in plain English, briefly. No clever tricks where
  plain code works.
- Don't add dependencies beyond the lists below without asking.
- No network at runtime except loading the app's own files: no CDN, no web fonts from other
  sites, no analytics. After the first visit everything works with no connection.

## Tech stack (fixed)

- Plain HTML, CSS and JavaScript ES modules (`<script type="module">`). No framework, no
  TypeScript, no bundler: the files in the repo are exactly the files the browser loads.
- Browsers: Chrome or Edge on Windows 10/11, installed as an app; Safari on iPhone (iOS 17 or
  newer), added to the Home Screen.
- **Runtime libraries** live in `vendor/`, each with its licence file. Exact versions are listed in
  `vendor/VERSIONS.txt`. Never load them from a CDN.
  - Vendor files end in `.js`, never `.mjs` (some web servers send `.mjs` with the wrong type,
    and a module with the wrong type does not load).
  - `@cantoo/pdf-lib` 2.11.1 (MIT): writes the PDF. `vendor/pdf-lib.esm.min.js`.
    Do **not** use the original `pdf-lib` (unmaintained since 2021; its font subsetting dropped
    most Noto Sans SC characters in tests) or jsPDF (cannot read `.ttc`, ~50× slower here).
  - `@cantoo/fontkit` 2.0.12 (MIT): reads the fonts for pdf-lib. Its
    browser file imports other packages by name, which a browser cannot resolve, so it is
    turned into one file **once, when vendoring**:
    `npx esbuild@0.28.2 node_modules/@cantoo/fontkit/dist/browser-module.mjs --bundle --format=esm --minify --outfile=vendor/fontkit.esm.min.js`.
    Import it as `import * as fontkit from '../vendor/fontkit.esm.min.js'` and use
    `fontkit.default ?? fontkit`.
    Write the exact command in `vendor/VERSIONS.txt`.
  - `jszip` 3.10.2 (MIT or GPL-3.0; we use MIT): reads `.docx` files. `vendor/jszip.min.js`.
    Import it for its side effect (`import '../vendor/jszip.min.js'`), then use
    `globalThis.JSZip`.
  - `pdfjs-dist` 6.4.299, **legacy build** (Apache-2.0; the legacy build is the one Safari
    needs): reads PDFs that contain real text. `vendor/pdfjs/pdf.min.js` and
    `vendor/pdfjs/pdf.worker.min.js` (copied from `legacy/build/*.min.mjs`, renamed), and
    `vendor/pdfjs/cmaps/` (needed for Chinese text). Load it only when the owner opens a PDF
    (`await import(...)`).
- **Dev-only tools** (never shipped, never needed by the owner):
  - Node 22: `node --test` for unit tests (built in, no test library).
  - `playwright` 1.56.1 (Node package, pinned in `package.json` `devDependencies`; it matches
    the Chromium build installed in the dev container) for browser tests.
  - Python 3.12+ with `fonttools` (make the font subsets) and `pymupdf` (check the test PDFs).
    Pinned in `tools/requirements-dev.txt`.
  - `esbuild` 0.28.2, only for the one vendoring command above.
- **Long jobs never freeze the page.** Building the PDF runs in a Web Worker
  (`js/sheet-worker.js`, `new Worker(url, {type: 'module'})`). Only the page touches the screen;
  the worker posts progress messages (`postMessage`) that the page shows. This is the browser
  version of the worker / queue / poll pattern in `reference/img2word.py`. Reading a large PDF
  uses pdf.js, which has its own worker.

## Hosting and offline

- Public repo `johnbui765/CHINESE-HANDWRITING-PRACTICE-1`, published with GitHub Pages from the `main` branch root:
  `https://johnbui765.github.io/CHINESE-HANDWRITING-PRACTICE-1/`.
  - The old private repo `CHINESE-HANDWRITING-PRACTICE` stays private. Its history contains a
    third-party worksheet PDF. Never copy `samples/` into the public repo.
- **All my PWAs share one origin** (`johnbui765.github.io`). That means they share Cache Storage,
  localStorage and IndexedDB. So (the name `hanzi-grid` was already taken in the account, so the
  app uses the repo name for its id and both prefixes: repo names are unique, so the prefixes
  are too):
  - `manifest.webmanifest`: `"id": "/CHINESE-HANDWRITING-PRACTICE-1/"` (never `"./"` or `"/"`: `id` resolves
    against the site root, not the app folder), `"start_url": "./"`, `"scope": "./"`,
    `"display": "standalone"`, name and short name `Hanzi Grid`, icons 192 × 192 and 512 × 512
    (plus a maskable one). `index.html` also links a 180 × 180 `apple-touch-icon` for iPhone.
  - Service worker `sw.js` in the app folder, registered with scope `./`.
    - Cache names start with **`chinese-handwriting-practice-1-`**: `chinese-handwriting-practice-1-<VERSION>`. `VERSION` (a fingerprint
      of all app files) and the `PRECACHE` list are written into `sw.js` by
      `python tools/make_precache.py`. Run it for every release.
    - On install: cache every file in `PRECACHE` (all app files, `vendor/` without licences,
      the two served fonts, `prompts/`, `data/common3500.txt`, `data/font-chars.txt`,
      `icons/`). Not `samples/`, `tests/`, `tools/` or `fonts/source/`.
    - Look things up only in this app's own cache (`caches.open(CACHE)`), never with
      `caches.match()`, which searches every app's caches.
    - On activate: delete only caches whose name starts with `chinese-handwriting-practice-1-` and is not the current
      one. Never touch any other cache.
    - On fetch: cache first, then network.
    - No `skipWaiting()`: a new version is used the next time the app is opened after all its
      windows are closed. The README says so.
  - localStorage keys start with **`chinese-handwriting-practice-1.`**. Never call `localStorage.clear()` and never
    read or delete keys without that prefix. No IndexedDB.
  - Ask once for persistent storage (`navigator.storage.persist()`); ignore the answer.
- On iPhone, the Home Screen app and Safari have **separate** storage. The README says so.

## Fonts

- **KaiTi:** `fonts/ukai-cn.ttf`, a subset of AR PL UKai CN (face 0 of `fonts/source/ukai.ttc`).
  - Characters: those of the 8,105 in 通用规范汉字表 (`data/common8105.txt`) that the font has.
    196 of the 8,105 lie outside U+4E00–9FFF and U+3400–4DBF (Extension B and later); the app
    never reads those, so they are left out (7,909 remain). UKai lacks 107 of the 7,909 (rare
    level-3 characters); Noto Sans SC has them all.
  - Made by `tools/make_fonts.py` with fontTools `pyftsubset`. The script prints how many of
    the 8,105 characters each font lacks.
  - Arphic Public License conditions: the subset file carries a notice in its `name` table
    (description) saying it is a modified version reduced to the 8,105 characters of
    通用规范汉字表, made with fontTools on <date>; `fonts/README.txt` says the same;
    `fonts/LICENSE-ukai.txt` ships unchanged; the public repo keeps the subset freely
    available. Keep the font name.
- **Print:** `fonts/noto-sans-sc.ttf`, a subset of **Noto Sans SC Regular**. Source:
  `fonts/source/NotoSansSC[wght].ttf` (the variable font from `github.com/google/fonts`,
  `ofl/notosanssc`). Its default weight is Thin (100), so `make_fonts.py` first takes the
  Regular weight (400) with fontTools' instancer, then cuts it down.
  - Characters: the same 8,105, plus what the labels and header need: U+0020–007E,
    U+00A0–024F (includes all pinyin tone letters such as ǎ ǐ ǒ ǔ ǚ), U+0300–036F,
    U+2010–2027, U+3000–303F, U+FF01–FF5E.
  - Licence: SIL Open Font License. Ship `fonts/OFL-notosanssc.txt` with it.
  - Microsoft YaHei is not used: Windows fonts may not be shipped in a web app. Noto Sans SC is
    the same 黑体 style; it is what Android phones show.
- The original full fonts stay in `fonts/source/` for re-making the subsets. They are not cached
  by the service worker.
- **On screen:** both subset files are loaded with CSS `@font-face` and used for the previews on
  the check screen. Nothing is drawn as an image.
- **In the PDF:** `pdfDoc.registerFontkit(fontkit)`, then `embedFont(bytes, {subset: true})`, so
  each PDF contains only the characters it uses.
- **Glyph check before printing:** every character of every word must exist in **both** fonts.
  `make_fonts.py` writes `data/font-chars.txt`: every Chinese character both subset fonts have
  (7,802). The check screen looks characters up in it, so the page never has to load the fonts
  into fontkit. A missing character is a red error ("not in the app's fonts: a traditional or
  rare character?").

## One page, two tabs

**Tab 1 "Get words"** → **Tab 2 "Make sheet"**. The layout must work on a phone screen (one
column, big touch targets) and on a PC.

### Part 1: Get the list

**Inputs:**

1. **Paste box.** Paste an AI reply, a lesson list or any text.
   - If at least one line looks like `number | …` (half-width `|` or full-width `｜`), read the
     text as an **AI reply** (see below). Otherwise read it as plain text.
2. **Open file** (a normal file picker): `.txt`, `.docx`, `.pdf` with real text inside.
3. **Picture-only PDFs and photos are not read by the app.** If a PDF has no Chinese text on any
   page, or the owner picks an image file, say so in plain words: "This PDF is a picture, there is
   no text inside. Use **Copy AI prompt**, then paste the AI's reply here."
4. **Copy AI prompt** button: copies `prompts/worksheet.txt` to the clipboard. Load the file when
   the app starts, so the copy happens directly inside the tap (iPhone requires that). If copying
   fails, show the prompt in a box with "Select all" so the owner can copy it by hand.
5. **Optional second paste box: "Compare with a second AI's reply."**

**Rules for reading text:**

- First apply Unicode `NFKC` normalisation (`text.normalize('NFKC')`). Some PDFs store simple
  characters as *Kangxi radical* code points (U+2F00–U+2FDF) that look identical. For example,
  ⼥ U+2F25 must become 女 U+5973. Without this, the range filter below silently drops them.
- Keep only CJK Unified Ideographs (U+4E00–U+9FFF) and Extension A (U+3400–U+4DBF).
- A **word** is one run of consecutive Chinese characters. Pinyin, Vietnamese, English, numbers,
  punctuation and spaces separate words and are discarded (except in the `|` columns described
  under "Lesson format" and "Reply format").
- Words are **never split into single characters**.
- Keep the order of first appearance. Remove repeated **words**, and say how many were removed.
  The same character may appear in several different words.
- **List name:** the first `#` line. If there are several (Bài 3, Bài 4), use "Bài 3–4". With
  no `#` line, use the file name without its extension, or "Untitled" for pasted text. It is
  always editable.
- **.docx:** open it with JSZip and parse `word/document.xml` with `DOMParser`. Walk every `w:p`
  element of the document body once, in document order. This covers body paragraphs, tables
  (nested too), text boxes and content controls. A paragraph's text is its own `w:t` text, with
  `w:tab` as a tab and `w:br` / `w:cr` as a line break; text that belongs to a `w:p` nested
  inside it (a text box) is not counted twice for the outer paragraph. Text boxes appear twice
  in the XML (`mc:Choice` and `mc:Fallback`); removing repeated words handles that.
- **PDF:** pdf.js `page.getTextContent()` on each page. It returns text in drawing order, not
  reading order, so sort it: items whose baselines are closer than half the font size are on the
  same line; lines go top to bottom (`transform[5]`, largest first); items in a line go left to
  right (`transform[4]`). Join items in a line directly, with a space where the gap between them
  is wider than 0.3 × the font size. Set `cMapUrl` to the vendored `cmaps/` folder and
  `cMapPacked: true`.
- **Lesson format** (also the format of saved lists). Pinyin and meaning are optional columns:
  ```
  # Bài 5
  女朋友 | nǚ péngyou | girlfriend
  哪 | nǎ | which
  国
  ```
  In a line with `|`, the first column is the word (all its Chinese characters joined), the
  second the pinyin, the third the meaning.

### The AI prompt and the reply format

- The prompt lives in `prompts/worksheet.txt` so the owner can change it without touching code.
  The starting version is below. Its format example must use words that are not in the samples.
- **Reply format:** a `#` line for each lesson name, then one line per word, then a total:
  `page | word | pinyin as printed | short English meaning`. A line ends with ` ?` when the AI is
  unsure. The last line is `# total: N`.
- **Reply reader (forgiving, like `json.js` in the owner's English app):**
  - It accepts code fences, text before or after the block, full-width `｜` pipes, extra spaces,
    missing pinyin or meaning columns, and numbering such as `1.`.
  - In reply lines, the word column is **one word**: all its Chinese characters joined, even if
    the AI put spaces between them (`妈 妈` → `妈妈`).
  - If the reply only repeats the prompt's format example, say so instead of loading it.
- **Pinyin check:** the pinyin's syllable count must equal the word's character count. Count a
  syllable for every group of consecutive vowels (`a e i o u ü v`, with or without tone marks);
  spaces, apostrophes and hyphens separate groups. So `nǚ péngyou` = 3, `jiějie` = 2,
  `Xī'ān` = 2. A mismatch is a warning.
- Pinyin and meaning are printed only on the **large-box** sheet (see Part 2). On the small-box
  sheet the pinyin is used only for the check above.
- **Two replies:** align the two word lists in order with a plain longest-common-subsequence
  table (the lists are short, so the simple table is fine). Mark every word where the two AIs
  disagree or that only one of them has.

Starting prompt (`prompts/worksheet.txt`):

```
You are copying Chinese vocabulary from the attached worksheet (PDF or images) for a
handwriting-practice app. Accuracy is the only goal: the learner is a beginner and cannot
check your work.

RULES
1. Read every page, in order. Never skip, summarise or stop early.
2. One line per vocabulary word, in the order it appears.
   - Worksheets with boxes: the word is the Chinese text in each box's header line, before
     /pinyin/. If that line has no Chinese, the word is the bold character at the start of
     the box's first row.
   - Any other document: every Chinese word or phrase, in reading order.
3. Ignore page titles (e.g. "Bài 3 我是中国人"), stroke-order steps, repeated model
   characters, empty grids, Vietnamese, English and numbers.
4. Copy characters and pinyin exactly as printed, in simplified Chinese. Do not correct,
   translate, convert to traditional characters, or add anything that is not on the page.
   The only exception is the meaning column: a short English meaning (1-5 words) that you
   write yourself.
5. If a word appears twice, write it twice.
6. If you are not completely sure of any character in a word, end that line with " ?".

OUTPUT: reply with ONLY one code block in exactly this format, nothing before or after it.
- A "#" line with the lesson name as printed at the top (e.g. # Bài 3), again whenever it changes.
- Then one line per word:  page number | word | pinyin as printed (empty if none) | English meaning
- Last line: # total: <number of word lines>

FORMAT EXAMPLE (made-up, not the answer):
# Bài 9
1 | 学生 | xué sheng | student
1 | 他 | tā | he
2 | 老师 | lǎo shī | teacher ?
# total: 3
```

### Check screen (the beginner's safety net)

There is one row per word. Each row shows:

- a large KaiTi preview of the whole word
- the print form
- pinyin and meaning (when known)
- the page number (when the word came from an AI reply)
- warnings
- the rows control (see Part 2)
- buttons: **edit** (word, pinyin, meaning), **move up/down**, **delete**, **merge with next
  line** (words joined; pinyin joined with a space; meanings joined with "; ")

Below the list, the owner can add a word by typing or pasting it.

**Warnings (orange: check this word):**

- The AI marked the line with `?`.
- The two AI replies disagree, or only one of them has the word.
- The pinyin syllable count is not the word's character count.
- A character is not in `data/common3500.txt`. This catches rare misreads.

**Errors (red: cannot print until fixed):**

- A character is missing from the KaiTi or the print font. This catches traditional characters
  (國) and very rare ones.
- The word has more characters than the sheet has columns (18 for small boxes, 12 for large
  boxes). The owner edits or splits it.

**Shown once at the top:** the `# total:` line doesn't match the number of words; how many
repeated words were removed.

**Save list** downloads `<name>.txt` in the lesson format, with the pinyin and meaning columns
when known (on iPhone: through the Share sheet, e.g. Save to Files). **Open list** is the normal
Open file. The current list is also kept in localStorage (`chinese-handwriting-practice-1.current`) so closing the app
loses nothing, but saved lists are files, because browser storage can be wiped.

## Part 2: Make the sheet

**Sheet type** setting: **Grid sheet** (the default, described first) or **Practice sheet**
(see "Practice sheet" below).

**Box size** setting of the grid sheet: **Small boxes** (10 mm, the default) or **Large boxes**
(15 mm). Both are described below. Common rules:

- A4 portrait. The PDF is drawn in points from the bottom-left corner, like reportlab:
  `mm = 72 / 25.4`.
- Every block is: row 1 = the word in KaiTi in cells 1..k, row 2 = the same word in the print
  font directly below it, then N empty rows. Cells k+1.. of rows 1–2 are normal empty practice
  boxes. One-character words work the same way.
- Every character is centred in **its own** cell: size 0.8 × cell, black, x centre from
  `font.widthOfTextAtSize(ch, FS)`, baseline `y + BOX/2 - 0.36*FS` (y = bottom of the cell).
- Drawing order: dashed crosses, then characters, then the solid grid, then block lines /
  labels.
- **Rows control, per word:** N empty rows. Quick buttons **1**, **3**, **6**, **Page**, plus a
  number box. **Page** = the whole page (N = 24 small, 15 large) and is stored as "Page", so it
  stays a whole page when the box size changes. A number above the new size's maximum becomes
  the maximum. The default N is 3, stored as a setting.
- **Page filling:** do a layout pass first. If a block fits in the space left on the current
  page, it goes there; otherwise it starts a new page. Blocks never split. Then draw every page,
  knowing the total.
- The owner prints in black and white. The greys are fine. If a dashed cross is too faint on
  their printer, darken it.

### Small boxes (10 mm): the approved layout

Keep everything from `reference/make_grid.py` unless it is listed as changed here:

- 10 mm cells, 18 columns × 26 rows, grid centred horizontally (15 mm side margins), grid top
  20 mm from the page top.
- Cell lines `#9a9a9a`, 0.5 pt. Dashed centre cross `#c4c4c4`, 0.35 pt, dash 1.5–1.5, in every
  cell.
- **Block line:** `#555555`, 1.1 pt, along the top edge of each block.

```
   1    2    3    4  …  18
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━   block line: #555555, 1.1 pt, along the top edge of the block
 │女 │朋 │友 │   │   │   │      row 1: the word in KaiTi, cells 1..k
 │女 │朋 │友 │   │   │   │      row 2: the same word in the print font, directly below
 │   │   │   │   │   │   │  ┐
 │   │   │   │   │   │   │  ├   N empty rows
 │   │   │   │   │   │   │  ┘
```

- **Changed from the reference:** the vertical divider after column 2 is removed (it would cut
  through words). Each block gets the horizontal block line instead.
- A block is 2 + N rows; a page holds 26 rows. Unused rows at the bottom of a page stay as
  empty grid.
- **Header** in the top margin (13 mm from the top), 8.5 pt grey `#666666`, print font:
  - left: `Row 1: KaiTi 楷体 (handwriting)   Row 2: print 黑体 (screen / phone)   Copy the KaiTi form in the empty boxes.`
  - right: `page/total`
  - Check the text width with `widthOfTextAtSize` and shrink the font if it would touch the page
    number.
- **No pinyin or meanings** on the small-box sheet.

### Large boxes (15 mm): the layout of `samples/Chinese character practice.pdf`

Measured from the sample (y = distance from the page top):

```
女朋友   nǚ péngyou   - girlfriend          label line, 12 pt, black, print font
┌────┬────┬────┬────┬ … ┐                   grid top 3 mm below the label baseline
│ 女 │ 朋 │ 友 │    │   │                   row 1: KaiTi
│ 女 │ 朋 │ 友 │    │   │                   row 2: print
│    │    │    │    │   │                   N empty rows
└────┴────┴────┴────┴ … ┘
- - - - - - - - - - - - - - - - - - - - -   cut line between blocks on the same page
哪   nǎ   - which
┌────┬ …
```

- 15 mm cells, 12 columns, grid from x = 15 mm to 195 mm.
- Cell lines `#666666`, 0.8 pt. Dashed centre cross `#b0b0b0`, 0.5 pt, dash 2–2, in every
  cell. Characters 0.8 × 15 mm = 34 pt.
- **Label line** above each block, print font, 12 pt, black, starting at x = 15 mm:
  `word   pinyin   - meaning` (three spaces between parts). Leave out a part that is unknown:
  `国   guó`, `国   - country`, or just `国`. Shrink the font if the label is wider than the grid.
- **First block on a page:** label baseline at 19 mm, grid top at 22 mm.
- **Next block on the same page:** a dashed cut line `#000999`, 0.5 pt, dash 4–3, from x = 15 mm
  to 195 mm, 6.5 mm below the previous grid's bottom; the label baseline 7 mm below the cut line;
  the grid top 3 mm below the label baseline (16.5 mm from one grid's bottom to the next grid's
  top).
- A grid's bottom may go down to 278.5 mm. So one block has at most 17 rows (N ≤ 15), and two
  blocks of 2 + 6 rows fit on one page, as in the sample.
- No page header and no page numbers, as in the sample.
- **Changed from the sample:** the sample draws each word as one string, so 朋 and 友 drift left
  of their cell centres. The app centres every character in its own cell.

### Practice sheet: the layout of the owner's `HSK1_Bai3-4_practice_kai.pdf`

Three parts; each part starts on a new page. One row per word: number, the word's boxes (one
14 mm box per character, outline and dashed cross `#000d33`, 0.8 pt / 0.4 pt dash 2–2), then
"side B": pinyin and `- meaning`.

- **Part 1: Model list (Side A: Side B)**: the word in KaiTi in the boxes, pinyin, meaning. It is
  also the answer key.
- **Part 2: Side B only** ("Write the character in the boxes."): empty boxes, pinyin, meaning.
- **Part 3: Mixed practice (rounds × words)** ("Character shown: write the pinyin and meaning on
  the line. Pinyin shown: write the character in the boxes."): **Round 1, 2, 3…**, each with every
  word once, in a new random order. Each item shows either the word (and a blank answer line
  `#000888` 0.5 pt from the pinyin column to x = 195 mm) or side B (and empty boxes).
  - Round 1 shows the word for a random half; round 2 swaps every word; round 3 is random again,
    round 4 swaps it… so every word is practised both ways.
  - A round never starts with the word that ended the round before.
  - A new random order every time Make PDF is pressed (`seed`); the same seed gives the same sheet
    (tests).
- **Rounds:** setting 1–5, default 3.
- **Box size:** 14 mm (the sample), 12 mm or 10 mm, to save paper. Characters are 0.8 × box.
- **Measured from the sample (14 mm; y = mm from the page top):** part title 14 pt at x 15,
  baseline 24; subtitle 9 pt baseline 30; first box 6.5 mm below the last title/heading baseline
  (30.5 / 36.5 / 47.5); continuation pages start at 19.5; rows every box + 3 mm (17); a box may
  end at 271.5. "Round N" 14 pt: 11 mm below the subtitle, or 7.5 mm below the box above it, with
  room for at least one row under it. In a row (scaled by box / 14 for smaller boxes): number
  10 pt right-aligned at x 23, baseline top + 8.5; pinyin 13 pt and meaning 10.5 pt (not below
  10 / 8 pt) on baseline top + 8; answer line at top + 12.
- **Side B column:** pinyin at x = 25 + max(3, k) × box + 6 mm (73 mm for 14 mm boxes); meaning
  30 mm (scaled) further right; both shrink to fit. A word longer than
  `floor((125 − 31) / box)` characters (6 / 7 / 9) is a red error in practice mode.
- **Missing pinyin or meaning never blocks printing** (owner's decision): tab 2 lists the words
  without pinyin and without meaning, each such word gets an orange warning, and the missing part
  is left empty on the sheet. A word with neither always shows the word in Part 3.
- The list name is printed small and grey at the right end of each part's title line.
- **Changed from the sample:** characters are centred in their own boxes (the sample drew each
  word as one string); long words push side B to the right instead of overlapping it.
- The rows-per-word control is hidden in practice mode (it only matters on the grid sheet).
- File name: `<list name>_practice.pdf`.

### Saving the PDF

- **File name:** `<list name>_grid.pdf` (grid) or `<list name>_practice.pdf` (practice), with
  characters Windows forbids in file names replaced.
  The browser (Windows) or the Files app (iPhone) deals with name clashes.
- The PDF title is the list name (`pdfDoc.setTitle`).
- **Make PDF** builds the file in the worker and shows progress. Then a **Save PDF** button
  appears (a second tap is needed: iPhone only allows sharing directly from a tap).
  - On a touch screen where `navigator.canShare({files: [pdf]})` is true (iPhone): open the
    Share sheet (Save to Files, Print, AirDrop).
  - Otherwise (Windows): download it with an `<a download>` link to a `blob:` URL. It goes to
    the browser's Downloads folder.

## Settings

localStorage `chinese-handwriting-practice-1.settings`: default empty rows (3), box size (small),
sheet type (grid), practice box size (14), rounds (3).

## Files and folders

- `index.html`: the page, two tabs. `app.css`: the styles.
- `js/app.js`: the screen (tabs, check screen, buttons); starts the worker; registers `sw.js`.
- `js/extract.js`: text rules, lesson format, reply reader, pinyin check, two-reply comparison.
  No browser APIs, so Node can test it.
- `js/readers.js`: file readers (`.txt`, `.docx` with JSZip, `.pdf` with pdf.js).
- `js/layout.js`: the layout pass for both box sizes: where every block, line, label and
  character goes. No browser APIs, no PDF library, so Node can test it.
- `js/practice.js`: the layout of the practice sheet (parts, rounds, random order). No browser
  APIs, so Node can test it.
- `js/draw.js`: turns a layout into PDF bytes with pdf-lib. Runs in the worker and in Node.
- `js/sheet-worker.js`: the worker: loads the fonts, calls `layout.js` and `draw.js`, posts
  progress and the finished PDF.
- `js/store.js`: settings, the current list, Save list.
- `sw.js`, `manifest.webmanifest`, `icons/`.
- `vendor/`: runtime libraries, their licences, `VERSIONS.txt`.
- `fonts/`: `ukai-cn.ttf`, `noto-sans-sc.ttf`, `LICENSE-ukai.txt`, `OFL-notosanssc.txt`,
  `README.txt` (the modification notice); `fonts/source/`: the full original fonts.
- `prompts/worksheet.txt`: the AI prompt.
- `data/common3500.txt`: 通用规范汉字表 (2013), level 1, exactly 3,500 characters, one per line.
  `data/common8105.txt`: all three levels, exactly 8,105 (3,500 + 3,000 + 1,605), used to make
  the font subsets.
  - Source: `shengdoushi/common-standard-chinese-characters-table` (`level-1.txt`,
    `level-2.txt`, `level-3.txt`).
  - Cross-checked against a second, independent copy: npm `togscc` 1.3.1
    (jaywcjlove/table-of-general-standard-chinese-characters). Same 8,105 characters, same
    order. Cite both in the README.
- `data/font-chars.txt`: the characters both fonts have (written by `make_fonts.py`).
- `tools/` (dev only): `make_fonts.py` (font subsets + `data/font-chars.txt`),
  `make_precache.py` (offline file list + version in `sw.js`), `make_icons.py` (app icons with
  Pillow), `check_pdf.py` (fonts, text, page count, pixel comparison with PyMuPDF),
  `requirements-dev.txt`.
- `tests/`: `node --test tests/` for `extract.js`, `layout.js`, `draw.js`; `tests/browser/` for
  Playwright. `tests/fixtures/sample_key.txt` is the answer key for the worksheet samples, made
  by reading the pages by eye. Tests that need `samples/` skip when it is missing.
  - Browser tests serve the app at `http://localhost:<port>/CHINESE-HANDWRITING-PRACTICE-1/` (`tests/browser/server.js`),
    the same path as on GitHub Pages, so the manifest `id` and the service worker scope are
    tested for real. Chromium is started with a UTF-8 locale (`LANG=C.UTF-8`); without one,
    Linux Chromium names downloads with non-ASCII names "download".
  - Test PDFs go to `tests/output/` (ignored by git).
- `package.json`: `"type": "module"`, dev dependencies only, `npm test` runs both test sets.
- `reference/`: read-only examples. `make_grid.py` = approved small-box layout.
  `img2word.py` = the worker pattern. Don't copy their Python; copy their decisions.
- `samples/`: the owner's PDFs for testing. **Never in the public repo** (`.gitignore`).
- `.gitignore`: `samples/*.pdf`, `node_modules/`, `.venv/`, `__pycache__/`, `tests/output/`.
- `README.md` for a non-programmer: install on Windows (Chrome/Edge "Install app") and iPhone
  (Safari → Share → Add to Home Screen); daily use; updates (close and reopen the app); how to
  publish with GitHub Pages; font and character-list sources and licences.

## How the modules fit together

```js
// js/extract.js: no browser APIs (Node tests import it directly)
readText(text, fallbackName)  // -> ListResult. Detects an AI reply (isReply) or reads plain/lesson text.
isReply(text)                 // -> boolean
readReply(text, fallbackName) // -> ListResult
compareReplies(entriesA, entriesB) // -> Entry[] in A's order, with B-only words inserted where they align
countSyllables(pinyin)        // -> number (the pinyin check)
toLessonText(name, entries)   // -> the text of a saved list (lesson format)
safeFileName(name)            // -> name with characters Windows forbids replaced by "_"

ListResult = {
  name,           // list name (rules in Part 1)
  entries,        // Entry[], in order, repeated words removed
  removed,        // how many repeated words were removed
  isReply,        // true when read as an AI reply
  lines,          // number of word lines read (before removing repeats)
  total,          // the reply's "# total:" number, or null
  echoedExample,  // true when the reply only repeats the prompt's format example
}
Entry = {
  word,     // Chinese characters only, e.g. "女朋友"
  pinyin,   // "" when unknown
  meaning,  // "" when unknown
  page,     // page number from an AI reply, or null
  unsure,   // true when the AI ended the line with " ?"
  compare,  // null, or after compareReplies: "same" | "differs" | "onlyA" | "onlyB"
  other,    // for "differs": the second reply's word; otherwise ""
}

// js/readers.js: browser only
readFile(file)        // -> { text, name } (name = file name without extension) or { picture: true }
docxText(arrayBuffer) // -> text, one line per paragraph
pdfText(arrayBuffer)  // -> text, one line per text line, pages in order

// js/layout.js: no browser APIs
layoutSheet(items, boxSize) // items = [{ word, pinyin, meaning, rows }] where rows is a number
                            // or "Page"; boxSize = "small" | "large".
                            // -> { boxSize, style, blocks, pages }, in PDF points. Each page
                            // lists, in drawing order: crosses, chars (cell centres), grid,
                            // marks (block / cut lines), texts (header, page number, labels).

// js/practice.js: no browser APIs
layoutPractice(items, { box, rounds, seed, name }) // -> the same shape as layoutSheet; marks of
                            // kind "answer" are the answer lines
practiceRounds(items, rounds, seed) // -> for each round: [{ index, show: "word" | "sideB" }]

// js/draw.js: runs in the worker and in Node
drawSheet(layout, fontBytes, title) // fontBytes = { kai, print } (ArrayBuffer) -> Uint8Array (the PDF)
// js/store.js: settings and the current list in localStorage ("chinese-handwriting-practice-1." keys), saveFile()
```

The page (`app.js`) owns everything on screen: it calls `readFile` / `readText`, keeps the
entries, adds the rows per word, computes the warnings and errors, and sends the items to the
worker. The worker calls `layoutSheet` and `drawSheet`.

## Notes about the samples

**Liao Laoshi HSK sheets** (the owner's usual worksheets). `Luyện viết HSK1 - (Part 3).pdf` was
removed from `samples/` but is still in the old private repo's history (commit `a84495e`). Use it
only for local tests; never put it in the public repo or a zip.

- They are **picture-only** PDFs: no text layer, no fonts, about 288 DPI JPEG pages.
- Each vocabulary box has a header line `女朋友 /nǚ péng you/ (đt) bạn gái`. For one-character
  words the header has only `/pinyin/ meaning` and the character is the bold label below it.
  Then come one stroke-order row per character and one model row repeating the word.
- Grid lines are dark grey. **Red is used inside characters** (radicals, the newest stroke) and
  grey for earlier stroke-order steps. The bold labels and header lines are pure black.
- Page titles such as `Bài 3 我是中国人` are not vocabulary. One file can hold two lessons (in
  Part 3: Bài 3 on pages 1–5, 18 words; Bài 4 on pages 6–8, 12 words).

**`Chinese character practice.pdf`** (7 pages, made with ReportLab, real text in WenQuanYi Zen
Hei and UKai CN):

- It is the model for the **large-box** layout (measurements above).
- It is also a **text-PDF test input**: 10 words, each three times (label, KaiTi row, print row),
  with pinyin and English. Reading it must give exactly 女朋友 哪 国 她 喂 姐姐 工作 还 忙 吗 and
  report 20 repeated words removed.

## Definition of done (v1)

Test each of these and report the results in the assessment:

1. Pasting mixed text (Chinese + pinyin + Vietnamese + English + numbers) gives exactly the
   Chinese words, in order, with no repeated words.
2. Files:
   - Lesson `.txt` (with and without the pinyin/meaning columns), `.docx` (paragraphs, a table,
     a nested table, a text box, Shift+Enter line breaks) and a text-layer PDF all work.
   - `samples/Chinese character practice.pdf` gives the 10 words above.
   - A PDF that uses Kangxi radical code points gives normal characters.
   - A picture-only PDF and a photo show the "use the AI prompt" message.
3. The AI route:
   - The prompt run in Claude on every page of the Liao Laoshi sample matches the answer key.
   - The owner's ChatGPT and Gemini replies are checked against the key. List every difference
     and whether a warning caught it.
   - Reader tests: a fenced reply, text around the block, full-width pipes, no pinyin column,
     no meaning column, `?` flags, a wrong total, an echoed format example, the pinyin syllable
     count, and the two-reply comparison.
4. Rows, for **both** box sizes:
   - N = 0 / 1 / 3 / 6 / Page each give exactly 2 + N rows per block.
   - Blocks never split, and Page fills one page (26 rows small, 17 rows large).
   - One-character and multi-character words both get the KaiTi row with the print row below.
   - Large boxes: labels with and without pinyin/meaning; the measurements match the sample
     (except the centring fix).
   - Changing the box size keeps "Page" as a whole page and lowers numbers above the maximum.
5. PyMuPDF shows UKai CN and Noto Sans SC embedded as subsets in a PDF made in Chromium, and every
   character renders the same as in a reference PDF that embeds the full fonts.
6. The page never freezes while the PDF is being built: with a 300-word list, a timer on the page
   keeps firing at least every 100 ms (measured in Playwright).
7. Offline and shared origin:
   - After one visit, with the network off, the app opens, reads a `.docx` and makes a PDF in both
     box sizes.
   - After a version change, caches named `otherapp-v1` and `hanzigrid-v1` still exist and only
     the old `chinese-handwriting-practice-1-` cache is gone.
   - The manifest `id` resolves to `/CHINESE-HANDWRITING-PRACTICE-1/` on the test server.
   - Nothing is fetched from any other origin.
8. Practice sheet: the 30 sample words give the sample's 13 pages with the same rows per page
   (14 / 15 / 1 / 14 / 15 / 1 / 13 / 15 / 14 / 15 / 14 / 15 / 4); positions match the sample; every
   round has every word once, half each way, round 2 swapped; 12 mm and 10 mm need fewer pages;
   missing pinyin/meaning is listed but prints; the PDF embeds both fonts.
9. On the owner's iPhone (manual checklist in the README): add to Home Screen, open in flight
   mode, Copy AI prompt, paste a reply, make a sheet in both sizes, Save PDF → Save to Files and
   Print.
10. The README steps work: install on Windows and iPhone, and publish on GitHub Pages.

## Out of scope for v1

- OCR inside the app and calling any AI or online API
- pinyin or meanings on the small-box sheet
- making pinyin automatically (it comes from the AI reply or is typed)
- a character bank and a "New only" filter
- stroke-order animation
- faint trace copies in the empty boxes
- reading the PC's installed Microsoft YaHei (Local Font Access works only in Chrome/Edge on a PC)
- a native iPhone or Windows app

Design so these can be added later, but don't build them.
