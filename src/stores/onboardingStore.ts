import { create } from "zustand";
import type { SectionId } from "@/components/editor/ControlPanel";

/**
 * Session-baserad onboarding-state. Reset:as när kunden byter mall (handle)
 * via `reset()`. Inget persisteras till localStorage — guidningen kommer
 * tillbaka nästa gång editorn öppnas.
 */
interface OnboardingState {
  completed: Partial<Record<SectionId, boolean>>;
  dismissed: Partial<Record<SectionId, boolean>>;
  markCompleted: (id: SectionId) => void;
  dismiss: (id: SectionId) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  completed: {},
  dismissed: {},
  markCompleted: (id) =>
    set((s) => (s.completed[id] ? s : { completed: { ...s.completed, [id]: true } })),
  dismiss: (id) =>
    set((s) => (s.dismissed[id] ? s : { dismissed: { ...s.dismissed, [id]: true } })),
  reset: () => set({ completed: {}, dismissed: {} }),
}));
