import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type ProductConfig } from "@/lib/product-config";
import { invokeAdmin, invokeWithSession } from "@/lib/admin-api";
import { Loader2, ExternalLink, Zap, Pencil, Plus, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveTemplate } from "@/lib/template-migrate";
import type { Template } from "@/lib/template-schema";
import CreateTemplateDialog from "@/components/admin/CreateTemplateDialog";
import TemplateThumbnail from "@/components/admin/TemplateThumbnail";
import LanguageToggle from "@/components/admin/LanguageToggle";
import { applyStoredAdminLocale } from "@/lib/admin-locale";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfigWithTemplate extends ProductConfig {
  __template: Template;
}

interface InstallStatus {
  shop: string;
  installed: boolean;
  scopes: string | null;
  installedAt: string | null;
}

export default function AdminConfigs() {
  const { t } = useTranslation();
  useEffect(() => {
    applyStoredAdminLocale();
  }, []);
  const [configs, setConfigs] = useState<ConfigWithTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [searchParams] = useSearchParams();

  const refreshInstallStatus = async () => {
    const shop = new URLSearchParams(window.location.search).get("shop");
    const { data, error } = await supabase.functions.invoke("shopify-oauth-status", {
      body: { shop },
    });
    if (!error && data) setInstallStatus(data as InstallStatus);
  };

  useEffect(() => {
    (async () => {
      try {
        // Admin needs DRAFT rows too, which RLS hides from the anon client —
        // load them through the tenant-scoped edge function (session-token auth).
        const res = await invokeAdmin<{ configs: ProductConfig[] }>("list");
        const enriched = (res.configs ?? []).map((c) => {
          const raw = (c as unknown as { template?: unknown }).template;
          const { template } = resolveTemplate(c, raw);
          return { ...c, __template: template };
        });
        setConfigs(enriched);
      } catch (e) {
        toast.error(t("admin.configs.loadError"), {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setLoading(false);
      }
    })();
    refreshInstallStatus();
  }, []);

  useEffect(() => {
    if (searchParams.get("installed") === "1") {
      toast.success(t("admin.configs.appInstalledToast"));
      refreshInstallStatus();
    }
  }, [searchParams]);

  const startInstall = async () => {
    setInstalling(true);
    try {
      const shop = new URLSearchParams(window.location.search).get("shop");
      const { data, error } = await supabase.functions.invoke("shopify-oauth-install", {
        body: { shop },
      });
      if (error || !data?.installUrl) {
        toast.error(t("admin.configs.installStartError"), {
          description: error?.message ?? data?.error ?? t("admin.configs.unknownError"),
        });
        return;
      }
      window.open(data.installUrl as string, "_blank", "noopener,noreferrer");
      toast.info(t("admin.configs.installWindowOpened"), {
        description: t("admin.configs.installWindowDescription"),
      });
    } finally {
      setInstalling(false);
    }
  };

  const syncToShopify = async () => {
    setSyncing(true);
    let okCount = 0;
    const failures: string[] = [];
    for (const cfg of configs) {
      const { data, error } = await invokeWithSession("shopify-sync-template", {
        handle: cfg.shopify_handle,
      });
      if (error || !data?.ok) {
        failures.push(`${cfg.shopify_handle}: ${error?.message ?? data?.error ?? t("admin.configs.errorLabel")}`);
      } else {
        okCount += 1;
      }
    }
    setSyncing(false);
    if (failures.length === 0) {
      toast.success(t("admin.configs.syncSuccess"), { description: t("admin.configs.syncSuccessDescription", { count: okCount }) });
    } else {
      toast.warning(t("admin.configs.syncPartialTitle", { count: failures.length }), {
        description: failures.slice(0, 3).join(" · "),
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold">{t("admin.configs.pageTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("admin.configs.pageSubtitle")}</p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t("admin.configs.createTemplate")}
              </Button>
              <Button onClick={() => setConfirmSyncOpen(true)} disabled={syncing || !installStatus?.installed || configs.length === 0}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                {t("admin.configs.syncToShopify")}
              </Button>
            </div>
          </div>

          {/* Shopify app install status */}
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {installStatus?.installed ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">
                    {t("admin.configs.appInstalledOn")} <span className="font-mono">{installStatus.shop}</span>
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="truncate">
                    {t("admin.configs.appNotInstalled")}{installStatus?.shop ? <> {t("admin.configs.onLabel")} <span className="font-mono">{installStatus.shop}</span></> : null} {t("admin.configs.syncDisabledUntilInstalled")}
                  </span>
                </>
              )}
            </div>
            <Button size="sm" variant={installStatus?.installed ? "outline" : "default"} onClick={startInstall} disabled={installing}>
              {installing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              {installStatus?.installed ? t("admin.configs.reinstall") : t("admin.configs.installApp")}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {configs.map((c) => {
              const isMulti = c.is_consolidated && (c.enabled_product_types?.length ?? 0) > 0;
              const thumbType = isMulti ? c.enabled_product_types![0] : c.product_type;
              const typeBadges = isMulti ? c.enabled_product_types! : [c.product_type];
              return (
              <Card key={c.id} className="p-5">
                <div className="flex gap-4">
                  <TemplateThumbnail template={c.__template} productType={thumbType} />
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold truncate">{c.title}</h2>
                        <p className="text-xs text-muted-foreground font-mono truncate">{c.shopify_handle}</p>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[50%]">
                        {typeBadges.map((t) => (
                          <span key={t} className="text-[10px] uppercase tracking-wider bg-secondary text-secondary-foreground px-2 py-1 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>{t("admin.configs.layersPortrait", { count: c.__template.defaultLayout.portrait.layers.length })}</div>
                      <div>{c.__template.publishedAt ? t("admin.configs.published") : t("admin.configs.draft")}</div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button asChild variant="default" size="sm" className="flex-1">
                        <Link to={`/admin/designer/${c.shopify_handle}`}>
                          <Pencil className="h-3 w-3 mr-1" />
                          {t("admin.configs.edit")}
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link to={`/editor?handle=${c.shopify_handle}`}>
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {t("admin.configs.editor")}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
              );
            })}
          </div>
        )}

        {!loading && configs.length === 0 && (
          <div className="mt-8 p-8 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
            {t("admin.configs.emptyState")}
          </div>
        )}
      </main>

      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog open={confirmSyncOpen} onOpenChange={setConfirmSyncOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.configs.confirmSyncTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.configs.confirmSyncDescription", { count: configs.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.configs.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSyncOpen(false);
                syncToShopify();
              }}
            >
              {t("admin.configs.confirmSyncAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
