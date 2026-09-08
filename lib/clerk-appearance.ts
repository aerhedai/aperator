// Points Clerk's theme variables at this app's own CSS custom properties
// (app/globals.css) instead of literal color values, so every Clerk
// surface — UserProfile, OrganizationProfile, UserButton, sign-in/up —
// tracks the app's palette automatically, light or dark, with nothing to
// keep in sync by hand. Set once on <ClerkProvider> in app/layout.tsx;
// every Clerk component in the tree inherits it unless it sets its own
// `appearance` prop locally. Left untyped against Clerk's own Appearance
// type (not a stable public export across @clerk/nextjs's re-exports) —
// structurally checked instead, wherever it's actually passed to a Clerk
// component's `appearance` prop.
export const clerkAppearance = {
  layout: {
    // Without this, Clerk falls back to whatever (or nothing) is set in
    // the Clerk Dashboard for this instance — generic and not this app's
    // own mark. logoPlacement stays "inside" (Clerk's default) so the
    // logo sits inside the themed card rather than floating above it.
    logoImageUrl: "/icon.png",
    logoLinkUrl: "/dashboard",
  },
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorDanger: "var(--destructive)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorNeutral: "var(--foreground)",
    colorForeground: "var(--foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorBackground: "var(--card)",
    colorInputForeground: "var(--foreground)",
    colorInput: "var(--card)",
    colorRing: "var(--ring)",
    colorBorder: "var(--border)",
    fontFamily: "var(--font-sans)",
    borderRadius: "var(--radius-md)",
  },
};
