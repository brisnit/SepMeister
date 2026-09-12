/**
 * Namespaced localStorage helpers.
 *
 * Every read is defensive: storage can be unavailable (private mode, blocked
 * site data), full, or hold data written by an older build. A shop losing its
 * presets is annoying; a shop unable to open the app at all because a parse
 * threw is unacceptable, so failures always degrade to the default.
 */

/**
 * Storage namespace. Deliberately still "sepai" after the rename to SepWiz:
 * changing it would orphan every preset and saved job already in a shop's
 * browser, and a cosmetic rename is not worth losing their setup over.
 */
const PREFIX = "sepai.v1.";

export function isStorageAvailable(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const probe = `${PREFIX}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** Returns false when the write failed, so callers can warn rather than assume. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing useful to do */
  }
}

export const STORAGE_KEYS = {
  presets: "presets",
  session: "session",
  feedback: "feedback",
  account: "account",
  emerald: "emerald-validation",
} as const;

/** Deterministic-enough unique id. Not security-sensitive. */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
