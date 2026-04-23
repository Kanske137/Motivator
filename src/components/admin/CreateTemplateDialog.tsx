// Dialog for creating a new product template (config row).
// Asks for title, auto-slugged Shopify handle, and a seed product type.
// Inserts a near-empty product_configs row and redirects to the designer.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PRODUCT_VARIANTS } from "@/lib/product-defaults";
import type { Template } from "@/lib/template-schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SeedKind = "poster" | "canvas" | "both";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

function buildSeedTemplate(kind: SeedKind): Template {
  const productOptions: Template["productOptions"] = {};
  if (kind === "poster" || kind === "both") {
    productOptions.poster = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.poster.sizes],
      allowedFrames: [...DEFAULT_PRODUCT_VARIANTS.poster.frames],
    };
  }
  if (kind === "canvas" || kind === "both") {
    productOptions.canvas = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.canvas.sizes],
      allowedDepths: [...DEFAULT_PRODUCT_VARIANTS.canvas.depths],
    };
  }
  return {
    version: 1,
    publishedAt: null,
    productOptions,
    orientations: ["portrait", "landscape"],
    defaultLayout: {
      portrait: { aspect: "3:4", background: { color: "#EFE7D6" }, layers: [] },
      landscape: { aspect: "4:3", background: { color: "#EFE7D6" }, layers: [] },
    },
    sizeOverrides: {},
  };
}

export default function CreateTemplateDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [kind, setKind] = useState<SeedKind>("both");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!handleEdited) setHandle(slugify(title));
  }, [title, handleEdited]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setHandle("");
      setHandleEdited(false);
      setKind("both");
      setSaving(false);
    }
  }, [open]);

  async function handleCreate() {
    if (!title.trim() || !handle.trim()) {
      toast.error("Titel och handle krävs");
      return;
    }
    setSaving(true);
    const template = buildSeedTemplate(kind);
    const productType = kind === "canvas" ? "canvas" : "posters";

    const { error } = await supabase.from("product_configs").insert({
      title: title.trim(),
      shopify_handle: handle.trim(),
      product_type: productType,
      template: template as unknown as never,
      layouts: {} as unknown as never,
      map_styles: ["light-v11", "dark-v11", "outdoors-v12", "satellite-v9"] as unknown as never,
      text_config: {
        fonts: ["Inter", "Playfair Display"],
        maxChars: 24,
        defaultFont: "Inter",
      } as unknown as never,
      sizes: [] as unknown as never,
      gelato_sku_map: {} as unknown as never,
    });

    // (don't reset saving yet — sync still pending)
    if (error) {
      setSaving(false);
      toast.error("Kunde inte skapa", { description: error.message });
      return;
    }

    // Sync to Shopify (productCreate). Failure here doesn't block — admin can retry.
    const { data: syncData, error: syncErr } = await supabase.functions.invoke(
      "shopify-sync-template",
      { body: { handle: handle.trim() } },
    );
    setSaving(false);
    if (syncErr || !syncData?.ok) {
      const code = (syncData as { code?: string } | null)?.code;
      const isAuth = code === "invalid_token" || code === "no_token" || code === "missing_scope";
      toast.warning(
        isAuth
          ? "Mall skapad — men Shopify-anslutningen är ogiltig"
          : "Mall skapad, men Shopify-synk misslyckades",
        {
          description: isAuth
            ? "Återanslut Shopify-integrationen i Lovable och kör Synka-knappen igen."
            : (syncErr?.message ?? syncData?.error ?? "Okänt fel — försök igen via Synka-knappen."),
        },
      );
    } else {
      toast.success("Mall skapad och Shopify-produkt synkad", {
        description: `${syncData.results?.length ?? 0} produkt(er) uppdaterade`,
      });
    }
    onOpenChange(false);
    navigate(`/admin/designer/${handle.trim()}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skapa ny mall</DialogTitle>
          <DialogDescription>
            En tom mall skapas. Du kan lägga till lager och varianter direkt efteråt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tpl-title">Titel</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Personlig stadkarta"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-handle">Shopify-handle</Label>
            <Input
              id="tpl-handle"
              value={handle}
              onChange={(e) => {
                setHandle(slugify(e.target.value));
                setHandleEdited(true);
              }}
              placeholder="personlig-stadkarta"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Produkttyp</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as SeedKind)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="poster" id="seed-poster" />
                <Label htmlFor="seed-poster" className="font-normal cursor-pointer">Poster</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="canvas" id="seed-canvas" />
                <Label htmlFor="seed-canvas" className="font-normal cursor-pointer">Canvas</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="both" id="seed-both" />
                <Label htmlFor="seed-both" className="font-normal cursor-pointer">Båda</Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Skapa & öppna
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
