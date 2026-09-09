"use client";

import { useState } from "react";

import {
  CalendarClock,
  FolderOpen,
  HardDrive,
  Inbox,
  Mail,
  MessageSquare,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { INTEGRATION_REGISTRY } from "@/lib/integrations/integration-registry";
import { cn } from "@/lib/utils";

// Real logo SVGs live in public/integrations/, dropped in by hand from
// each provider's own brand kit — lowercase filename, underscore between
// words (google_drive.svg) — and matched here against the provider slug
// rather than a filesystem read, since this component renders on the
// client. A provider with no entry, or whose file 404s (not dropped in
// yet), falls back to the colored Lucide tile below.
const LOGO_FILENAMES: Record<string, string> = {
  gmail: "gmail.svg",
  slack: "slack.svg",
  outlook: "outlook.svg",
  teams: "teams.svg",
  "outlook-calendar": "outlook_calendar.svg",
  "google-drive": "google_drive.svg",
  sharepoint: "sharepoint.svg",
};

// Fallback for a provider with no logo file (yet), or whose logo failed
// to load — enough to visually distinguish cards at a glance, paired with
// the label text for actual identification.
const ICONS: Record<string, { Icon: LucideIcon; className: string }> = {
  gmail: {
    Icon: Mail,
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  slack: {
    Icon: MessageSquare,
    className: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  },
  outlook: {
    Icon: Inbox,
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  teams: {
    Icon: Users,
    className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  },
  "outlook-calendar": {
    Icon: CalendarClock,
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  webhook: {
    Icon: Webhook,
    className: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  },
  "google-drive": {
    Icon: HardDrive,
    className: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  sharepoint: {
    Icon: FolderOpen,
    className: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  },
};

export function IntegrationIcon({ provider }: { provider: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoFilename = LOGO_FILENAMES[provider];

  if (logoFilename && !logoFailed) {
    const label =
      INTEGRATION_REGISTRY.find((entry) => entry.provider === provider)
        ?.label ?? provider;
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image
            doesn't optimize SVGs anyway, and these are small fixed-size
            local files, not something worth its config surface. */}
        <img
          src={`/integrations/${logoFilename}`}
          alt={`${label} logo`}
          className="size-full object-contain"
          onError={() => setLogoFailed(true)}
        />
      </div>
    );
  }

  const { Icon, className } = ICONS[provider] ?? {
    Icon: Webhook,
    className: "bg-muted text-muted-foreground",
  };

  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
    >
      <Icon className="size-5" />
    </div>
  );
}
