"""Makes the binary test files in tests/fixtures/ (dev only, never shipped).

Run it from anywhere with the dev Python (see tools/requirements-dev.txt: pymupdf, fonttools):

    python tests/fixtures/make_fixtures.py

It writes:
  docx_*.docx          hand-built Word files (zipfile + plain XML), one per feature
  text_layer.pdf       a PDF with real text, drawn out of reading order on purpose
  kangxi.pdf           a PDF whose text layer uses Kangxi radical code points (U+2F25 for 女)
  letter_spacing.pdf   words drawn with letter spacing, as in the large-box sample
  cmap.pdf             a PDF with a standard Chinese font that is not embedded (needs cmaps/)
  picture.pdf          a picture-only PDF (an image, no text)
  picture.png, photo.jpg   small images of Chinese text
  lesson_utf16.txt, lesson_gb18030.txt   the same short lesson in two other encodings

The .txt lesson files in UTF-8 are written by hand and are not made here.
The expected words for each file are in tests/browser/readers.test.js.
"""

import io
import logging
import sys
import zipfile
from pathlib import Path

import pymupdf
from fontTools import subset
from fontTools.ttLib import TTFont

# fontTools prints a note for every table it cannot subset; those notes are not errors.
logging.getLogger("fontTools.subset").setLevel(logging.ERROR)

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent

# A Chinese font that also has the Kangxi radical code points (U+2F00-U+2FDF).
FONT_CANDIDATES = [
    PROJECT / "fonts" / "source" / "ukai.ttc",
    Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
]


# --------------------------------------------------------------------------------------------
# Fonts
# --------------------------------------------------------------------------------------------

def small_font(text):
    """A small TrueType font with only the characters in `text` (keeps the PDFs tiny)."""
    for path in FONT_CANDIDATES:
        if not path.exists():
            continue
        font = TTFont(str(path), fontNumber=0)
        cmap = font.getBestCmap()
        if all(ord(ch) in cmap for ch in set(text) if not ch.isspace()):
            options = subset.Options()
            options.name_IDs = ["*"]
            options.notdef_outline = True
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=sorted({ord(ch) for ch in text} | {32}))
            subsetter.subset(font)
            buffer = io.BytesIO()
            font.flavor = None
            font.save(buffer)
            return buffer.getvalue()
    sys.exit("No font found with all characters of: " + text)


# --------------------------------------------------------------------------------------------
# PDFs
# --------------------------------------------------------------------------------------------

def draw(page, x, y_from_top, text, size=20):
    """Writes text with its baseline y_from_top points below the top of the page."""
    page.insert_text((x, y_from_top), text, fontname="F0", fontsize=size)


def make_text_layer_pdf():
    # Drawn out of reading order, so the reader must sort the pieces by position.
    chars = "你好再见朋友谢谢中文汉字第二页nihao"
    font = small_font(chars)
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="F0", fontbuffer=font)
    draw(page, 50, 180, "中文")                # line 3, drawn first
    draw(page, 70, 140, "友")                  # line 2: 朋 + 友 drawn as two pieces, no gap
    draw(page, 50, 140, "朋")
    draw(page, 150, 140, "谢谢")               # line 2: far to the right -> its own word
    draw(page, 200, 100, "再见")               # line 1, right part first
    draw(page, 50, 100, "你好")                # line 1
    draw(page, 100, 100, "ni hao", size=10)    # pinyin between the two words
    draw(page, 50, 220, "汉")                  # line 4: 字 sits 2 pt lower but is on the same line
    draw(page, 70, 222, "字")
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="F0", fontbuffer=font)
    draw(page, 50, 100, "第二页")
    draw(page, 50, 140, "你好")                # a repeat
    doc.save(HERE / "text_layer.pdf", garbage=4, deflate=True)


def make_kangxi_pdf():
    # ⼥ U+2F25 (女), ⼈ U+2F08 (人), ⼝ U+2F1D (口), ⽉ U+2F49 (月)
    text_lines = ["\u2F25朋友", "\u2F08", "\u2F1D", "\u2F49亮"]
    font = small_font("".join(text_lines))
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="F0", fontbuffer=font)
    for number, line in enumerate(text_lines):
        draw(page, 50, 100 + 40 * number, line)
    doc.save(HERE / "kangxi.pdf", garbage=4, deflate=True)

    # Check that the Kangxi code point really is in the text layer.
    check = pymupdf.open(HERE / "kangxi.pdf")
    layer = check[0].get_text()
    if "\u2F25" not in layer or "\u5973" in layer:
        sys.exit("kangxi.pdf: U+2F25 is not in the text layer: " + repr(layer))


def make_letter_spacing_pdf():
    """Words drawn as one string with letter spacing (the PDF operator Tc), like the KaiTi rows
    of samples/Chinese character practice.pdf. pdf.js puts a space between the characters."""
    font_bytes = small_font("女朋友哪国她")
    font = TTFont(io.BytesIO(font_bytes))
    cmap = font.getBestCmap()

    def glyph_ids(text):
        # The font is embedded with Identity-H encoding: a character's code is its glyph number.
        return "".join(f"{font.getGlyphID(cmap[ord(ch)]):04X}" for ch in text)

    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="F0", fontbuffer=font_bytes)
    size = 34
    content = (
        # 0.25 × the font size between the characters: one word.
        f"BT /F0 {size} Tf {0.25 * size} Tc 1 0 0 1 50 700 Tm <{glyph_ids('女朋友')}> Tj ET\n"
        # 0.45 × the font size between the characters: three words.
        f"BT /F0 {size} Tf {0.45 * size} Tc 1 0 0 1 50 600 Tm <{glyph_ids('哪国她')}> Tj ET\n"
    )
    stream = doc.get_new_xref()
    doc.update_object(stream, "<<>>")
    doc.update_stream(stream, content.encode("ascii"))
    doc.xref_set_key(page.xref, "Contents", f"{stream} 0 R")
    doc.save(HERE / "letter_spacing.pdf", garbage=4, deflate=True)

    layer = pymupdf.open(HERE / "letter_spacing.pdf")[0].get_text()
    if "朋" not in layer or "她" not in layer:
        sys.exit("letter_spacing.pdf: the text layer is wrong: " + repr(layer))


def make_cmap_pdf():
    """A PDF that uses a standard Chinese font without embedding it (STSong-Light with the
    UniGB-UCS2-H encoding, as ReportLab's UnicodeCIDFont does). pdf.js can read its text only
    with the vendored cmaps/ folder."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)

    descriptor = doc.get_new_xref()
    doc.update_object(
        descriptor,
        "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 "
        "/FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 "
        "/CapHeight 880 /StemV 93 >>",
    )
    cid_font = doc.get_new_xref()
    doc.update_object(
        cid_font,
        "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light "
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> "
        f"/FontDescriptor {descriptor} 0 R /DW 1000 >>",
    )
    font = doc.get_new_xref()
    doc.update_object(
        font,
        "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light-UniGB-UCS2-H "
        f"/Encoding /UniGB-UCS2-H /DescendantFonts [{cid_font} 0 R] >>",
    )
    doc.xref_set_key(page.xref, "Resources", f"<< /Font << /F1 {font} 0 R >> >>")

    # With UniGB-UCS2-H, each character is written as its 4-digit Unicode number.
    def codes(text):
        return "".join(f"{ord(ch):04X}" for ch in text)

    content = (
        f"BT /F1 24 Tf 1 0 0 1 50 700 Tm <{codes('女朋友')}> Tj ET\n"
        f"BT /F1 24 Tf 1 0 0 1 50 650 Tm <{codes('你好')}> Tj ET\n"
    )
    stream = doc.get_new_xref()
    doc.update_object(stream, "<<>>")
    doc.update_stream(stream, content.encode("ascii"))
    doc.xref_set_key(page.xref, "Contents", f"{stream} 0 R")
    doc.save(HERE / "cmap.pdf", garbage=4, deflate=True)

    layer = pymupdf.open(HERE / "cmap.pdf")[0].get_text().split()
    if layer != ["女朋友", "你好"]:
        sys.exit("cmap.pdf: the text layer is wrong: " + repr(layer))


def text_picture_png(text, dpi=72):
    """A PNG of Chinese text: a one-page PDF with the text, turned into an image."""
    font = small_font(text)
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=80)
    page.insert_font(fontname="F0", fontbuffer=font)
    draw(page, 20, 50, text, size=32)
    return page.get_pixmap(dpi=dpi)


def make_pictures():
    pixmap = text_picture_png("你好再见")
    pixmap.save(HERE / "picture.png")
    pixmap.save(HERE / "photo.jpg", jpg_quality=80)

    # A picture-only PDF: the page holds only an image of Chinese text, no text layer.
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    image = text_picture_png("女朋友", dpi=150).tobytes("png")
    page.insert_image(pymupdf.Rect(50, 50, 450, 210), stream=image)
    doc.save(HERE / "picture.pdf", garbage=4, deflate=True)
    if pymupdf.open(HERE / "picture.pdf")[0].get_text().strip():
        sys.exit("picture.pdf must not have text")


# --------------------------------------------------------------------------------------------
# .docx files: the smallest set of parts Word needs, written by hand.
# --------------------------------------------------------------------------------------------

NAMESPACES = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'mc:Ignorable="wps"'
)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

PACKAGE_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>
<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"""


def run(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def para(*parts):
    return "<w:p>" + "".join(parts) + "</w:p>"


def cell(*parts):
    return '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' + "".join(parts) + "</w:tc>"


def table(*rows):
    grid = '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>'
    body = "".join("<w:tr>" + "".join(row) + "</w:tr>" for row in rows)
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' + grid + body + "</w:tbl>"


def text_box(text):
    """A text box the way Word saves it: once as a modern shape, once as old VML."""
    box_paragraph = para(run(text))
    return (
        "<w:r><mc:AlternateContent>"
        '<mc:Choice Requires="wps"><w:drawing>'
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        '<wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Text Box 1"/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/>'
        '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>'
        f"<wps:txbx><w:txbxContent>{box_paragraph}</w:txbxContent></wps:txbx>"
        "<wps:bodyPr/></wps:wsp>"
        "</a:graphicData></a:graphic></wp:inline>"
        "</w:drawing></mc:Choice>"
        '<mc:Fallback><w:pict><v:shape style="width:72pt;height:36pt">'
        f"<v:textbox><w:txbxContent>{box_paragraph}</w:txbxContent></v:textbox>"
        "</v:shape></w:pict></mc:Fallback>"
        "</mc:AlternateContent></w:r>"
    )


def picture_run():
    return (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        '<wp:extent cx="1905000" cy="762000"/><wp:docPr id="2" name="Picture 1"/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="762000"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
        "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    )


def write_docx(name, body, image=None):
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f"<w:document {NAMESPACES}><w:body>{body}"
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'
        "</w:body></w:document>"
    )
    with zipfile.ZipFile(HERE / name, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", PACKAGE_RELS)
        z.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        z.writestr("word/document.xml", document)
        if image:
            z.writestr("word/media/image1.png", image)


def make_docx_files():
    # Paragraphs: a list name, a word split over two runs, mixed text, a repeat.
    write_docx("docx_paragraphs.docx", "".join([
        para(run("# Bài 7")),
        para(run("女"), run("朋友"), run(" nǚ péngyou - girlfriend")),
        para(run("Xin chào 哪 nǎ which")),
        para(run("国")),
        para(run("女朋友")),
    ]))

    # A table with a nested table in one cell.
    inner = table([cell(para(run("工作"))), cell(para(run("还")))])
    write_docx("docx_table.docx", table(
        [cell(para(run("她"))), cell(para(run("喂")))],
        [cell(para(run("姐姐"))), cell(inner, para(run("忙")))],
    ))

    # A text box. Its text is in the file twice (mc:Choice and mc:Fallback).
    write_docx("docx_textbox.docx", "".join([
        para(run("太 "), text_box("吗")),
        para(run("对")),
    ]))

    # Shift+Enter (w:br), w:cr and a tab. The paragraph settings hold tab stops (w:tabs/w:tab)
    # that must not be read as tabs.
    tab_stops = '<w:pPr><w:tabs><w:tab w:val="left" w:pos="2000"/></w:tabs></w:pPr>'
    write_docx("docx_breaks.docx", "".join([
        para(run("国"), "<w:r><w:br/></w:r>", run("中国")),
        para(tab_stops, run("哪"), "<w:r><w:tab/></w:r>", run("那里")),
        para(run("法国"), "<w:r><w:cr/></w:r>", run("越南")),
    ]))

    # Content controls (block and inline), a hyperlink and a field whose code has Chinese in it.
    write_docx("docx_controls.docx", "".join([
        '<w:sdt><w:sdtPr><w:alias w:val="Box"/></w:sdtPr><w:sdtContent>'
        + para(run("想"))
        + "</w:sdtContent></w:sdt>",
        para(run("我 "), '<w:sdt><w:sdtPr/><w:sdtContent>' + run("有") + "</w:sdtContent></w:sdt>"),
        para('<w:hyperlink r:id="rIdLink">' + run("泰国") + "</w:hyperlink>"),
        para(
            '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
            '<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.com/错误" </w:instrText></w:r>',
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
            run("中文"),
            '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
        ),
    ]))

    # Tracked changes: deleted text (w:del / w:delText) must not appear; inserted text does.
    write_docx("docx_deleted.docx", "".join([
        para(
            run("爸爸 "),
            '<w:del w:id="1" w:author="T" w:date="2026-01-01T00:00:00Z">'
            '<w:r><w:delText>错字</w:delText></w:r></w:del>',
            '<w:ins w:id="2" w:author="T" w:date="2026-01-01T00:00:00Z">' + run("妈妈") + "</w:ins>",
        ),
        # Only the paragraph mark is deleted here (w:pPr/w:rPr/w:del); the text stays.
        para(
            '<w:pPr><w:rPr><w:del w:id="3" w:author="T" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>',
            run("妹妹"),
        ),
    ]))

    # Only a picture, no text: a scanned worksheet pasted into Word.
    image = text_picture_png("女朋友").tobytes("png")
    write_docx("docx_picture.docx", para(picture_run()), image=image)


# --------------------------------------------------------------------------------------------
# Text files in other encodings
# --------------------------------------------------------------------------------------------

def make_encoded_text():
    lesson = "# 第三课\r\n你好 | nǐ hǎo | hello\r\n谢谢\r\n"
    (HERE / "lesson_utf16.txt").write_bytes(b"\xff\xfe" + lesson.encode("utf-16-le"))
    (HERE / "lesson_gb18030.txt").write_bytes(lesson.encode("gb18030"))


if __name__ == "__main__":
    make_text_layer_pdf()
    make_kangxi_pdf()
    make_letter_spacing_pdf()
    make_cmap_pdf()
    make_pictures()
    make_docx_files()
    make_encoded_text()
    print("Fixtures written to", HERE)
