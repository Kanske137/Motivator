// Confirmation dialog for permanently deleting a template (and its Shopify products).
// User must type the localized confirmation word (e.g. "RADERA") before the destructive
// action becomes enabled.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invokeWithSession } from "@/lib/admin-api";

interface DeleteTemplateDialogProps {
  productConfigId: string;
  shopifyHandle: string;
  title: string;
}

export default function DeleteTemplateDialog({
  productConfigId,
  shopifyHandle,
  title,
}: DeleteTemplateDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const expected = t("adminDelete.placeholder");
  const matches = confirmText === expected;

  async function handleDelete() {
    if (!matches || busy) return;
    setBusy(true);
    try {
      const { data, error } = await invokeWithSession("shopify-delete-template", {
        product_config_id: productConfigId,
        confirm: "RADERA",
      });
      if (error || !data?.ok) {
        toast.error(t("adminDelete.error"), {
          description: error?.message ?? data?.error ?? "",
        });
        setBusy(false);
        return;
      }
      const shopifyErrors = (data.shopifyErrors ?? []) as string[];
      if (shopifyErrors.length > 0) {
        toast.warning(t("adminDelete.successWithErrors"), {
          description: shopifyErrors.slice(0, 3).join(" · "),
        });
      } else {
        toast.success(t("adminDelete.success"));
      }
      setOpen(false);
      navigate("/admin/configs");
    } catch (e) {
      toast.error(t("adminDelete.error"), {
        description: e instanceof Error ? e.message : String(e),
      });
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setConfirmText("");
          setBusy(false);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-2" />
          {t("adminDelete.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("adminDelete.title")}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{t("adminDelete.warning")}</span>
            <span className="block font-mono text-xs text-muted-foreground">
              {t("adminDelete.target", { title, handle: shopifyHandle })}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-delete">{t("adminDelete.confirmHint")}</Label>
          <Input
            id="confirm-delete"
            autoComplete="off"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={expected}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("adminDelete.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={!matches || busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
            {t("adminDelete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
