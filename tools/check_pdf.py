"""Check a practice PDF (dev only).

    python tools/check_pdf.py sheet.pdf              list pages, fonts and text
    python tools/check_pdf.py sheet.pdf --json       the same as JSON (used by the tests)
    python tools/check_pdf.py a.pdf --compare b.pdf  render both and count differing pixels
    python tools/check_pdf.py sheet.pdf --render out_folder

Needs PyMuPDF (see tools/requirements-dev.txt).
"""

import json
import pathlib
import sys

import pymupdf


def describe(path):
    doc = pymupdf.open(path)
    fonts = {}
    for page in doc:
        for xref, ext, kind, basefont, name, encoding, *rest in page.get_fonts(full=True):
            if basefont in fonts:
                continue
            program = doc.extract_font(xref)[3] if ext not in ("", "n/a") else b""
            fonts[basefont] = {
                "name": basefont,
                "type": kind,
                "embedded": ext not in ("", "n/a"),
                # Size of the embedded font program. A subset of a few characters is a few KB;
                # the whole KaiTi font would be about 5 MB.
                "bytes": len(program),
            }
    return {
        "pages": doc.page_count,
        "title": doc.metadata.get("title", ""),
        "fonts": sorted(fonts.values(), key=lambda f: f["name"]),
        "text": [page.get_text() for page in doc],
    }


def compare(path_a, path_b, dpi=100):
    a, b = pymupdf.open(path_a), pymupdf.open(path_b)
    if a.page_count != b.page_count:
        return {"same_page_count": False, "pages": []}
    result = []
    for page_a, page_b in zip(a, b):
        pix_a = page_a.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        pix_b = page_b.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        diff = sum(1 for x, y in zip(pix_a.samples, pix_b.samples) if abs(x - y) > 8)
        result.append(diff)
    return {"same_page_count": True, "differing_pixels_per_page": result}


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    path = argv[0]
    if "--compare" in argv:
        print(json.dumps(compare(path, argv[argv.index("--compare") + 1])))
        return 0
    if "--render" in argv:
        out = pathlib.Path(argv[argv.index("--render") + 1])
        out.mkdir(parents=True, exist_ok=True)
        for number, page in enumerate(pymupdf.open(path), start=1):
            page.get_pixmap(dpi=100).save(out / f"page-{number}.png")
        print(f"rendered into {out}")
        return 0
    info = describe(path)
    if "--json" in argv:
        print(json.dumps(info, ensure_ascii=False))
        return 0
    print(f"{path}: {info['pages']} page(s), title {info['title']!r}")
    for font in info["fonts"]:
        state = f"embedded, {font['bytes']:,} bytes" if font["embedded"] else "NOT embedded"
        print(f"  font {font['name']}  ({font['type']}, {state})")
    print("  text on page 1:", " ".join(info["text"][0].split())[:120] if info["text"] else "")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
