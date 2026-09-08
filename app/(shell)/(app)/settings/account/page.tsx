import { UserProfile } from "@clerk/nextjs";

import { ThemeToggle } from "@/components/settings/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Personal account/security settings (email, password, MFA, active
// sessions, and — if enabled for this Clerk instance — account deletion)
// are Clerk's own responsibility, not hand-rolled here: this app is
// already Clerk-authenticated, so duplicating that UI would mean a second,
// unmaintained source of truth for security-sensitive flows (CLAUDE.md
// §22). routing="hash" embeds Clerk's internal navigation (its own
// sub-tabs) without needing a dedicated catch-all route under /settings.
//
// Theme is the one personal preference that isn't Clerk's to own — it's
// local display state (lib/use-theme.ts), not account data — so it gets
// its own card here rather than living inside the embedded UserProfile.
export default function AccountSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Account</h2>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <UserProfile routing="hash" />
    </div>
  );
}
