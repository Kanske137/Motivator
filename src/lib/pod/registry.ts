// Provider registry (client). Resolve a PodProvider by id. Gelato is the only
// adapter today; Printful + Printify register here in Phase 3e.
import { gelatoProvider } from "./gelato-provider";
import type { PodProvider } from "./types";

export const DEFAULT_PROVIDER_ID = "gelato";

const PROVIDERS: Record<string, PodProvider> = {
  gelato: gelatoProvider,
};

/** The provider for `id`, falling back to the default (Gelato) for unknown ids. */
export function getPodProvider(id: string = DEFAULT_PROVIDER_ID): PodProvider {
  return PROVIDERS[id] ?? PROVIDERS[DEFAULT_PROVIDER_ID];
}

/** All registered provider ids (for admin pickers later). */
export function listPodProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
