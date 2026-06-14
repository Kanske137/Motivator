// Persistent localStorage cache for MULTI face-swap results.
// Keys results by `${layerId}|${refUrl}|${sortedSlotHashes}` so the exact
// same combination of (layer, reference, slot uploads) never re-runs.
// LRU-evicts at MAX_ENTRIES.
//
// This is INTENTIONALLY a separate store from `face-swap-cache` so that
// single-face caching behavior remains 100% unchanged.

export interface MultiFaceCacheEntry {
  url: string;
  layerId: string;
  cacheKey: string;
  timestamp: number;
}

const STORAGE_KEY = "lovable.multi-face-cache.v1";
const MAX_ENTRIES = 20;

export function loadMultiFaceCache(): Record<string, MultiFaceCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) return {};
    const out: Record<string, MultiFaceCacheEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, MultiFaceCacheEntry>)) {
      if (v && typeof v === "object" && v.url && v.layerId && v.cacheKey) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveMultiFaceCache(cache: Record<string, MultiFaceCacheEntry>): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(cache);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed: Record<string, MultiFaceCacheEntry> = {};
      for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota
  }
}

/** Build a stable cache key from (layerId, refUrl, slot[id+hash] list). */
export function makeMultiFaceKey(
  layerId: string,
  referenceImageUrl: string,
  slotHashes: Array<{ slotId: string; hash: string }>,
): string {
  const sorted = [...slotHashes]
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .map((s) => `${s.slotId}:${s.hash}`)
    .join("|");
  return `${layerId}::${referenceImageUrl}::${sorted}`;
}
