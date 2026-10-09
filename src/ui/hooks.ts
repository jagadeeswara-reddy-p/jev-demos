import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { ArenaBackend } from "../arena/types";
import type { ArenaStore } from "./store";

export interface ArenaContextValue {
  store: ArenaStore;
  backend: () => ArenaBackend;
}

export const ArenaContext = createContext<ArenaContextValue | null>(null);

export function useArena(): ArenaContextValue {
  const ctx = useContext(ArenaContext);
  if (!ctx) throw new Error("useArena must be used inside ArenaContext");
  return ctx;
}

/** Re-renders when the store changes (at most once per animation frame). */
export function useArenaState() {
  const { store } = useArena();
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state;
}

// One requestAnimationFrame loop shared by every canvas and timer on the page.
const frameCallbacks = new Set<(now: number) => void>();
let frameId: number | null = null;

function tick(now: number) {
  for (const cb of frameCallbacks) cb(now);
  frameId = frameCallbacks.size > 0 ? requestAnimationFrame(tick) : null;
}

export function useFrame(callback: (now: number) => void) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const cb = (now: number) => ref.current(now);
    frameCallbacks.add(cb);
    if (frameId === null) frameId = requestAnimationFrame(tick);
    return () => {
      frameCallbacks.delete(cb);
    };
  }, []);
}
