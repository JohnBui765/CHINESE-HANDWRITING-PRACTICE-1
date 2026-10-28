"""Write the list of files the service worker keeps for offline use (dev only).

    python tools/make_precache.py

Run it before every release. It rewrites the lines between the PRECACHE-START and
PRECACHE-END markers in sw.js:
  VERSION   a short fingerprint of all app files, so any change makes a new cache name
  PRECACHE  every file the app needs at runtime
"""

import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Files and folders the app loads at runtime. Licences, tools, tests, samples and the full
# source fonts are not needed offline.
FILES = [
    "index.html",
    "app.css",
    "manifest.webmanifest",
    "fonts/ukai-cn.ttf",
    "fonts/noto-sans-sc.ttf",
    "data/common3500.txt",
    "data/font-chars.txt",
]
FOLDERS = ["js", "icons", "prompts", "vendor"]
SKIP_NAMES = re.compile(r"^(LICENSE|VERSIONS|README)", re.IGNORECASE)


def runtime_files():
    found = list(FILES)
    for folder in FOLDERS:
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file() and not SKIP_NAMES.match(path.name):
                found.append(path.relative_to(ROOT).as_posix())
    return found


def main():
    files = runtime_files()
    digest = hashlib.sha256()
    for name in files:
        digest.update(name.encode())
        digest.update((ROOT / name).read_bytes())
    version = digest.hexdigest()[:10]
    block = (
        "// PRECACHE-START (written by tools/make_precache.py; do not edit by hand)\n"
        f"const VERSION = '{version}';\n"
        f"const PRECACHE = {json.dumps(['./'] + files, indent=2)};\n"
        "// PRECACHE-END"
    )
    sw = ROOT / "sw.js"
    text = sw.read_text("utf-8")
    text = re.sub(r"// PRECACHE-START.*?// PRECACHE-END", lambda m: block, text, flags=re.S)
    sw.write_text(text, "utf-8")
    print(f"sw.js: version {version}, {len(files) + 1} files")


if __name__ == "__main__":
    main()
