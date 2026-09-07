import { UserProfile } from "@clerk/nextjs";

// Personal account/security settings (email, password, MFA, active
// sessions, and — if enabled for this Clerk instance — account deletion)
// are Clerk's own responsibility, not hand-rolled here: this app is
// already Clerk-authenticated, so duplicating that UI would mean a second,
// unmaintained source of truth for security-sensitive flows (CLAUDE.md
// §22). routing="hash" embeds Clerk's internal navigation (its own
// sub-tabs) without needing a dedicated catch-all route under /settings.
export default function AccountSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Account</h2>
      <UserProfile routing="hash" />
    </div>
  );
}
