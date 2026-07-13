export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full.
  }
}

export function storedText(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function storeText(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredText(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable.
  }
}
