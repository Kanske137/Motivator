// Admin inspector sub-section for the OPTIONAL multi-face-swap mode on an
// aiPhoto layer. Strictly additive — rendered INSIDE the existing aiPhoto
// inspector block as a collapsible / titled card. When the toggle is OFF
// (default), the parent layer behaves exactly like today's single-face
// aiPhoto.
import { useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TemplateLayer } from "@/lib/template-schema";
import { DEFAULT_MULTI_FACE_PROMPT } from "@/lib/ai-photo-prompts";

type AiPhotoLayer = Extract<TemplateLayer, { type: "aiPhoto" }>;

interface Props {
  layer: AiPhotoLayer;
  onChange: (next: TemplateLayer) => void;
}

const MAX_SLOTS = 4;
const MIN_SLOTS = 2;

function defaultSlot(idx: number) {
  return {
    id: `slot-${idx + 1}`,
    label: `Person ${idx + 1}`,
    position: idx === 0 ? "left" : idx === 1 ? "right" : idx === 2 ? "center" : `position-${idx + 1}`,
  };
}

export default function MultiFaceInspector({ layer, onChange }: Props) {
  const cfg = layer.defaults.multiFaceSwap;
  const enabled = !!cfg?.enabled;
  const slots = cfg?.slots ?? [];
  const isRemoveBg = layer.defaults.subjectKind === "removeBackground";

  // When admin enables multiFace on a layer that still has the default
  // swap-prompt (or empty), drop in the multi-face default so they have
  // something sensible to edit.
  useEffect(() => {
    if (!enabled) return;
    const cur = (layer.defaults.swapPrompt ?? "").trim();
    if (cur.length === 0 || cur.includes("face/head onto the reference subject")) {
      onChange({
        ...layer,
        defaults: { ...layer.defaults, swapPrompt: DEFAULT_MULTI_FACE_PROMPT },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const update = (patch: Partial<NonNullable<AiPhotoLayer["defaults"]["multiFaceSwap"]>>) => {
    const next = { ...(cfg ?? { enabled: false, slots: [defaultSlot(0), defaultSlot(1)] }), ...patch };
    onChange({ ...layer, defaults: { ...layer.defaults, multiFaceSwap: next } });
  };

  const toggleEnabled = (v: boolean) => {
    if (v) {
      update({
        enabled: true,
        slots: slots.length >= MIN_SLOTS ? slots : [defaultSlot(0), defaultSlot(1)],
      });
    } else {
      update({ enabled: false, slots: slots.length >= MIN_SLOTS ? slots : [defaultSlot(0), defaultSlot(1)] });
    }
  };

  const setFaceCount = (n: number) => {
    const target = Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, n));
    let next = slots.slice(0, target);
    while (next.length < target) next.push(defaultSlot(next.length));
    update({ enabled, slots: next });
  };

  const setSlotField = (idx: number, field: "label" | "position", value: string) => {
    const next = slots.map((s, i) => (i === idx ? { ...s, [field]: value } : s));
    update({ enabled, slots: next });
  };

  const addSlot = () => {
    if (slots.length >= MAX_SLOTS) return;
    update({ enabled, slots: [...slots, defaultSlot(slots.length)] });
  };

  const removeSlot = (idx: number) => {
    if (slots.length <= MIN_SLOTS) return;
    update({ enabled, slots: slots.filter((_, i) => i !== idx) });
  };

  // The whole section is hidden for removeBackground subjects — multi-face
  // semantics don't apply there. (Background-removal handles a single
  // subject by definition.)
  if (isRemoveBg) return null;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <Label className="text-xs font-semibold">Multi face-swap (flera ansikten)</Label>
          <p className="text-[10px] text-muted-foreground">
            När detta är på laddar kunden upp ett porträtt per ansikte och alla
            byts in i ett enda AI-anrop. Lämna av för vanlig 1-ansikts face-swap.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggleEnabled} />
      </div>

      {enabled && (
        <>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Label className="text-xs">Antal ansikten ({MIN_SLOTS}–{MAX_SLOTS})</Label>
            <Input
              type="number"
              min={MIN_SLOTS}
              max={MAX_SLOTS}
              step={1}
              value={slots.length || MIN_SLOTS}
              onChange={(e) => setFaceCount(parseInt(e.target.value, 10) || MIN_SLOTS)}
              className="h-8 w-20 text-xs"
            />
          </div>

          <div className="space-y-2">
            {slots.map((s, idx) => (
              <div
                key={s.id}
                className="rounded-md border bg-background p-2 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Slot #{idx + 1}
                  </span>
                  {slots.length > MIN_SLOTS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSlot(idx)}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      title="Ta bort slot"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Etikett</Label>
                    <Input
                      value={s.label}
                      onChange={(e) => setSlotField(idx, "label", e.target.value)}
                      placeholder="Kung"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Position</Label>
                    <Input
                      value={s.position}
                      onChange={(e) => setSlotField(idx, "position", e.target.value)}
                      placeholder="left / right / center …"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {slots.length < MAX_SLOTS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSlot}
              className="w-full h-8"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Lägg till slot
            </Button>
          )}

          <p className="text-[10px] text-muted-foreground">
            Tips: prompten ovan skickas till modellen. Använd <code>{"{{SLOTS}}"}</code> där
            mappningarna (position → bild-nr) ska injiceras automatiskt.
          </p>
        </>
      )}
    </div>
  );
}
