// Per-viewer conveniences kept in browser storage. Storage may be off or
// refused (a private window, blocked site data): reads then find nothing and
// writes are dropped, so the page starts as on a first view.

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered: the next view starts as this one did.
  }
}
