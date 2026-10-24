// Settings, the current list, and saving files.
// All my web apps share one web address (johnbui765.github.io), so they share localStorage.
// Every key this app uses starts with "chinese-handwriting-practice-1." and the app never touches other keys.

const PREFIX = 'chinese-handwriting-practice-1.';

// sheetType: "grid" (small or large boxes) or "practice" (model list, side B, mixed rounds)
export const DEFAULT_SETTINGS = { defaultRows: 3, boxSize: 'small', sheetType: 'grid', practiceBox: 14, rounds: 3 };

// localStorage can be missing or full (private browsing), so every read and write is
// wrapped: the app keeps working, it just doesn't remember.
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not saved; nothing else to do.
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
}

export function saveSettings(settings) {
  write('settings', settings);
}

// The current list: { name, entries, notices }
export function loadCurrent() {
  return read('current', null);
}

export function saveCurrent(list) {
  write('current', list);
}

// True on a phone or tablet that can share this file (iPhone: Save to Files, Print, AirDrop).
export function canShareFile(file) {
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return Boolean(touch && navigator.canShare && navigator.canShare({ files: [file] }));
}

// Save a file. Must be called directly from a tap: iPhone only allows the Share sheet then.
export function saveFile(blob, fileName) {
  const file = new File([blob], fileName, { type: blob.type });
  if (canShareFile(file)) {
    return navigator.share({ files: [file], title: fileName }).catch(error => {
      // The owner closed the Share sheet: not an error.
      if (error && error.name === 'AbortError') return;
      throw error;
    });
  }
  // Windows (and anything else): an ordinary download into the Downloads folder.
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Promise.resolve();
}
