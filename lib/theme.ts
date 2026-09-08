export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "aperator-theme";

// Runs synchronously in <head>, before first paint (see app/layout.tsx) —
// without this, the page would render in the default (light) theme for
// one frame and then flash to dark once React hydrates and lib/use-theme's
// effect runs. Must stay a plain string injected via
// dangerouslySetInnerHTML rather than a React component: it has to
// execute before hydration, not after it.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var isDark=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",isDark);}catch(e){}})();`;
