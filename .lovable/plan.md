## Två buggar bakom symptomen

### 1. `normalizeType` känner inte igen `aluminum`/`acrylic`

```ts
function normalizeType(raw) {
  if (v === "poster" || v === "posters") return "posters";
  if (v === "canvas") return "canvas";
  return undefined;   // ← aluminum/acrylic faller hit
}
```

När du klickar Metallposter sätts `?type=aluminum`, men `typeParam` blir `undefined`. `resolveConfigForHandle` saknar då preferens och returnerar default (poster-varianten först → "förblir på posterdelen").

### 2. `useEffect` kör om hela laddningen vid varje typbyte

```ts
useEffect(() => {
  setLoading(true);
  const all = await loadAllConfigs();   // onödig DB-fetch
  setConfigs(all);
  ...
}, [handleParam, typeParam, setConfig]);
```

`onProductChange` uppdaterar `?type=` → effekten triggar → `setLoading(true)` → spinner + omladdning av alla configs från Supabase. Det är därför editorn "laddas om" varje typbyte. Konfigerna finns redan i state — det räcker att resolva på plats.

## Fix

### `src/pages/EditorPage.tsx`

**A.** Utöka `normalizeType` till att returnera `"aluminum"` och `"acrylic"`.

**B.** Dela upp ladd-effekten i två:
- En första-laddning (kör bara när `configs.length === 0`) som hämtar alla configs en gång och sätter initial `config`.
- En lättviktig effekt som lyssnar på `[handleParam, typeParam, configs]` och anropar `setConfig(resolveConfigForHandle(configs, handleParam, typeParam))` — utan `setLoading(true)`, utan ny DB-fetch.

Då blir typbyte instant: URL uppdateras, ny config sätts från befintlig state-array, FormatSection re-renderar med rätt `activeProductType` direkt.

### Vad som inte ändras
- `onProductChange`-signatur, FormatSection-toggle, variantresolver — allt fortsätter fungera.
- Initial laddning + spinner-beteende vid första sidladdning.

### Verifiering
1. Öppna editorn på Poster → klick Metallposter: ingen spinner, byte sker direkt, Metallposter blir aktiv knapp.
2. Klick tillbaka till Poster: ingen omladdning.
3. Hard reload med `?handle=...&type=acrylic`: laddar Plexiglas direkt.
