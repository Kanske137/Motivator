import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import EditorPage from "./pages/EditorPage.tsx";
import AdminConfigs from "./pages/AdminConfigs.tsx";
import DesignerPage from "./pages/admin/DesignerPage.tsx";
import SettingsPage from "./pages/admin/SettingsPage.tsx";
import AiLibraryPage from "./pages/admin/AiLibraryPage.tsx";

import { useCartSync } from "./hooks/useCartSync";
import { useShopContextBootstrap } from "./hooks/useShopContextBootstrap";
import { isEmbedded } from "./lib/shopify-app-bridge";

const queryClient = new QueryClient();

const AppRoutes = () => {
  useCartSync();
  useShopContextBootstrap();
  return (
    <>
      {/* App Bridge renders these as the Wallery app's sub-tabs in Shopify admin.
          Only in the embedded admin (not the storefront editor). */}
      {isEmbedded() && (
        <ui-nav-menu>
          {/* App Bridge treats the rel="home" link as the app title, not a tab —
              Template needs its own entry to actually show up. */}
          <a href="/" rel="home">Motiv</a>
          <a href="/admin/configs">Template</a>
          <a href="/admin/settings">Pricing</a>
          <a href="/admin/ai">AI recipes</a>
        </ui-nav-menu>
      )}
      <Routes>
      <Route path="/" element={<AdminConfigs />} />
      <Route path="/home" element={<Index />} />
      <Route path="/editor" element={<EditorPage />} />
      <Route path="/admin/configs" element={<AdminConfigs />} />
      <Route path="/admin/designer/:handle" element={<DesignerPage />} />
      <Route path="/admin/settings" element={<SettingsPage />} />
      <Route path="/admin/ai" element={<AiLibraryPage />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
