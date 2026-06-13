// Global AI busy state. Any AI flow (style, face-swap, object-swap,
// remove-background, …) registers a job here so the editor can render a
// blocking fullscreen overlay and freeze interaction until all jobs end.
import { create } from "zustand";

export interface AiJob {
  id: string;
  label: string;
  stage: string | null;
  expectedSeconds: number;
  startedAt: number;
}

interface AiBusyState {
  jobs: Record<string, AiJob>;
  startAiJob: (id: string, opts: { label: string; expectedSeconds: number; stage?: string | null }) => void;
  updateAiJobStage: (id: string, stage: string | null) => void;
  endAiJob: (id: string) => void;
}

export const useAiBusyStore = create<AiBusyState>((set) => ({
  jobs: {},
  startAiJob: (id, { label, expectedSeconds, stage = null }) =>
    set((s) => ({
      jobs: {
        ...s.jobs,
        [id]: { id, label, expectedSeconds, stage, startedAt: performance.now() },
      },
    })),
  updateAiJobStage: (id, stage) =>
    set((s) => {
      const cur = s.jobs[id];
      if (!cur) return s;
      return { jobs: { ...s.jobs, [id]: { ...cur, stage } } };
    }),
  endAiJob: (id) =>
    set((s) => {
      if (!s.jobs[id]) return s;
      const next = { ...s.jobs };
      delete next[id];
      return { jobs: next };
    }),
}));

/** True when at least one AI job is active. */
export function useIsAnyAiBusy(): boolean {
  return useAiBusyStore((s) => Object.keys(s.jobs).length > 0);
}

/** The most recently started job, used to drive the overlay's label/stage. */
export function usePrimaryAiJob(): AiJob | null {
  return useAiBusyStore((s) => {
    const list = Object.values(s.jobs);
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
  });
}
