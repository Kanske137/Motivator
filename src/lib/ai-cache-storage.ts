// Lightweight localStorage persistence for the AI style result cache.
// Keys results by `${photoHash}|${presetId}` where photoHash is a SHA-256 of
// the file bytes. This makes the cache survive both URL changes (we re-upload
// the same file to a new path) and full page reloads. Capped at MAX_ENTRIES
// with LRU eviction.

export interface AiCacheEntry {
  url: string;          // print-files URL of the AI-styled image
  presetId: string;
  presetLabel: string;
  photoHash: string;    // stable content hash of the source photo
  timestamp: number;    // ms epoch — used for LRU
}

const STORAGE_KEY = "lovable.ai-cache.v2";
const MAX_ENTRIES = 30;

export function loadAiCache(): Record<string, AiCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) return {};
    // Defensive: drop entries missing required fields (e.g. from a partial
    // earlier write). photoHash is required.
    const out: Record<string, AiCacheEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, AiCacheEntry>)) {
      if (v && typeof v === "object" && v.url && v.photoHash && v.presetId) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAiCache(cache: Record<string, AiCacheEntry>): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(cache);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed: Record<string, AiCacheEntry> = {};
      for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors etc.
  }
}

export function makeCacheKey(photoHash: string, presetId: string): string {
  return `${photoHash}|${presetId}`;
}

/** SHA-256 hash of the file's bytes, returned as a lowercase hex string.
 *  Stable across uploads of the same file and across page reloads. */
export async function hashFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
