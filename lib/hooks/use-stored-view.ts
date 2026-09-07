"use client";

import { useSyncExternalStore } from "react";

// A list's view preference (tile vs. list) persisted per-browser. Built on
// useSyncExternalStore rather than useState+useEffect specifically to
// avoid a real hydration mismatch: the server has no localStorage to read,
// so it must render `fallback`; useSyncExternalStore's getServerSnapshot
// is the sanctioned way to say "server and first client paint render this
// value, then react to what's actually stored" without React flagging a
// setState-during-effect anti-pattern for what's genuinely a one-time
// external-store read, not a state update loop.
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function useStoredView<T extends string>(
  key: string,
  fallback: T,
  valid: readonly T[],
): [T, (next: T) => void] {
  const getSnapshot = () => {
    const saved = window.localStorage.getItem(key);
    return (valid as readonly string[]).includes(saved ?? "")
      ? (saved as T)
      : fallback;
  };
  const getServerSnapshot = () => fallback;

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function setValue(next: T) {
    window.localStorage.setItem(key, next);
    // The native "storage" event only fires in *other* tabs/windows, never
    // the one that made the change — dispatch it manually so this tab's
    // own useSyncExternalStore subscription re-reads the new value too.
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }

  return [value, setValue];
}
