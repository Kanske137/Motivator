// Lightweight localStorage persistence for the AI style result cache.
// Keys results by `${photoUrl}|${presetId}` so the same upload + same preset
// is recognised across page reloads. Capped at MAX_ENTRIES with LRU eviction.

export interface AiCacheEntry {
  url: string;          // print-files URL of the AI-styled image
  presetId: string;
  presetLabel: string;
  photoKey: string;     // typically the originalPhotoUrl
  timestamp: number;    // ms epoch — used for LRU
}

const STORAGE_KEY = "lovable.ai-cache.v1";
const MAX_ENTRIES = 30;

export function loadAiCache(): Record<string, AiCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAiCache(cache: Record<string, AiCacheEntry>): void {
  if (typeof window === "undefined") return;
  try {
    // LRU-evict oldest entries when over cap.
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

export function makeCacheKey(photoKey: string, presetId: string): string {
  return `${photoKey}|${presetId}`;
}
