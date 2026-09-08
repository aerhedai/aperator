"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

// Same shape as the sidebar-collapse preference in
// components/layout/sidebar.tsx: useSyncExternalStore reads the
// persisted value safely across server/client render passes (server has
// no localStorage, so it always renders "system" — getServerTheme), and
// a local override state reflects a click in *this* tab immediately.
// That override matters because the 'storage' event this hook otherwise
// relies on only fires in *other* tabs, never the one that wrote the
// value.
function subscribeToThemeStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function getServerTheme(): Theme {
  return "system";
}

function subscribeToSystemScheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSystemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerSystemPrefersDark() {
  return false;
}

export function useTheme() {
  const storedTheme = useSyncExternalStore(
    subscribeToThemeStorage,
    getStoredTheme,
    getServerTheme,
  );
  const [override, setOverride] = useState<Theme | null>(null);
  const theme = override ?? storedTheme;

  // Tracked live (not just read once) so "System" re-resolves immediately
  // if the OS theme changes while this tab is open, not only on reload.
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemScheme,
    getSystemPrefersDark,
    getServerSystemPrefersDark,
  );

  useEffect(() => {
    const resolvedDark =
      theme === "system" ? systemPrefersDark : theme === "dark";
    document.documentElement.classList.toggle("dark", resolvedDark);
  }, [theme, systemPrefersDark]);

  function setTheme(next: Theme) {
    setOverride(next);
    if (next === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  }

  return { theme, setTheme };
}
