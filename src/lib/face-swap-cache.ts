// Persistent localStorage cache for face-swap results.
// Keys results by `${faceHash}|${referenceImageUrl}|${layerId}` so the same
// selfie + same admin reference + same layer never re-runs Replicate.
// LRU-evicts at MAX_ENTRIES.

export interface FaceSwapCacheEntry {
  url: string;              // print-files URL of the swapped image
  layerId: string;
  faceHash: string;
  referenceImageUrl: string;
  timestamp: number;
}

const STORAGE_KEY = "lovable.face-swap-cache.v1";
const MAX_ENTRIES = 30;

export function loadFaceSwapCache(): Record<string, FaceSwapCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) return {};
    const out: Record<string, FaceSwapCacheEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, FaceSwapCacheEntry>)) {
      if (v && typeof v === "object" && v.url && v.faceHash && v.referenceImageUrl && v.layerId) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveFaceSwapCache(cache: Record<string, FaceSwapCacheEntry>): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(cache);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed: Record<string, FaceSwapCacheEntry> = {};
      for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota
  }
}

export function makeFaceSwapKey(
  faceHash: string,
  referenceImageUrl: string,
  layerId: string,
): string {
  return `${faceHash}|${referenceImageUrl}|${layerId}`;
}
