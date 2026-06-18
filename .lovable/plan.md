# Cachad stil ska appliceras direkt vid klick

## Problem
I `AiPhotoSection` (Förvandling-fliken, removeBackground med flera stilar) sätter klick på en stil-knapp bara `selectedStyleId`. Resultatet på lagret uppdateras först när kunden trycker "Skapa nu". Det ska ske direkt om vi redan har en cachad bild för den stilen.

## Fix
I `src/components/editor/AiPhotoSection.tsx`, style-picker `onClick`:
- Sätt `selectedStyleId` som idag.
- Om `cachedUrl` finns för `(layer.id, source.hash, refSlotFor("removeBackground", null, p.id))` → kalla `setAiPhotoResult(layer.id, cachedUrl)` omedelbart så lagret byter bild direkt.
- Om ingen cache finns → låt resultatet vara orört (kunden måste fortfarande trycka "Skapa nu" för att generera).

Subjekt-väljaren (human/pet) hanteras redan korrekt av befintlig `useEffect` som synkar `result` när `refUrl` ändras. Multi-face-historiken sätter redan resultatet vid klick. Ingen ändring där.

## Verifiering
1. Bilposter, ladda upp bil, kör Pop-art → byt till Skiss (osparad) → byt tillbaka till Pop-art: lagret ska direkt visa den cachade Pop-art-bilden utan "Skapa nu"-tryck.
2. Tryck på en stil som inte körts: lagret behåller nuvarande resultat och "Skapa nu"-knappen blir vägen framåt.
