

## Fix: ImageScript-bibliotek inkompatibelt med Edge Runtime

### Problemet

Edge function-loggen visar:
```
event loop error: Error: unsupported arch/platform: Not supported
at .../imagescript/1.3.0/codecs/node/index.js:3:21
```

`npm:imagescript@1.3.0` försöker ladda ett **native Node.js binding** som inte finns i Deno Edge Runtime. Funktionen kraschar redan vid boot → 0 print-filer genereras → Gelato får ingen order.

### Lösningen: Byt till Deno-native bibliotek

ImageScript finns i en **ren Deno-version** på deno.land som inte har node-binding-problemet. Det är **samma bibliotek**, samma API, men distribuerat som ren TS för Deno.

**Ändring i `supabase/functions/generate-print-file/index.ts`:**

Byt rad 17:
```ts
// FÖRE (kraschar):
import { Image, decode } from "npm:imagescript@1.3.0";

// EFTER (fungerar i Deno Edge Runtime):
import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
```

Version 1.2.17 är den senaste stabila Deno-publicerade versionen. API:t (`Image`, `decode`, `Image.renderText`, `setPixelAt`, `composite`, `encode`, `resize`) är identiskt med det vi redan använder → **ingen annan kodändring behövs**.

### Fallback-plan om deno.land-versionen också ger problem

Om importen misslyckas (deno.land-registrets stilar varierar ibland), använd istället:
```ts
import { Image, decode } from "https://esm.sh/imagescript@1.2.17?target=deno";
```
`?target=deno` tvingar esm.sh att leverera Deno-kompatibel bundle utan node-bindings.

### Verifiering

1. Deploya funktionen → boot-loggen ska visa `booted` utan UncaughtException
2. Du lägger ny testorder via Bogus Gateway (cirkel + labels off + text)
3. `gelato_orders` → status `submitted`, `gelato_order_id` finns
4. Print-fil-URL öppnas → cirkulär karta + text syns
5. Gelato dashboard visar ordern

### Filer som ändras

- `supabase/functions/generate-print-file/index.ts` — endast `import`-raden (rad 17)

Inget annat rörs: editor, cart, webhook, store — allt orört.

