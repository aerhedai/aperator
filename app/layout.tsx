import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { cn } from "@/lib/utils";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Aperator",
  description: "AI-powered business process automation platform.",
};

// Deliberately no app chrome here — the internal Nav lives in
// app/(app)/layout.tsx, scoped to just the authenticated product, not the
// public marketing site or the sign-in/sign-up/select-organisation flow.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      {/* suppressHydrationWarning: the theme script below adds/removes
          .dark on this exact element before React hydrates, so its
          className legitimately differs from the server-rendered markup
          — expected, not a real mismatch. Scoped to this one element; it
          doesn't suppress hydration checks anywhere else. */}
      <html
        lang="en"
        className={cn("font-sans", sans.variable, mono.variable)}
        suppressHydrationWarning
      >
        <head>
          {/* Sets the .dark class before first paint — see lib/theme.ts
              for why this can't just be a React effect. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
