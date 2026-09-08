import {
  Activity,
  Bot,
  BookText,
  CheckCircle2,
  Table2,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import { checkInboxAction } from "@/app/(shell)/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import * as dashboardService from "@/lib/dashboard/dashboard-service";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

const JUMP_TO = [
  {
    href: "/workflows",
    label: "Workflows",
    detail: "Classifier + handler routing for each trigger.",
    icon: Workflow,
  },
  {
    href: "/agents",
    label: "Agents",
    detail: "Instructions, granted tools, and execution mode.",
    icon: Bot,
  },
  {
    href: "/runs",
    label: "Runs",
    detail: "Every execution, step by step, with token cost.",
    icon: Activity,
  },
  {
    href: "/catalog",
    label: "Catalog",
    detail: "Your own record types — Products, Customers, and more.",
    icon: Table2,
  },
  {
    href: "/knowledge",
    label: "Knowledge",
    detail: "Indexed documents agents can retrieve answers from.",
    icon: BookText,
  },
  {
    href: "/approvals",
    label: "Approvals",
    detail: "Proposed actions held for a human decision.",
    icon: CheckCircle2,
  },
];

const EMAIL_PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
};

// Always show live counts; this must never be a stale build-time snapshot.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const {
    inbox_processed: inboxProcessed,
    inbox_skipped: inboxSkipped,
    inbox_error: inboxError,
  } = await searchParams;
  const organisation = await getCurrentOrganisation();
  const [counts, emailIntegrations, totalTokens] = await Promise.all([
    dashboardService.getDashboardCounts(organisation.id),
    integrationService.getConnectedEmailIntegrations(organisation.id),
    dashboardService.getTotalTokenUsage(organisation.id),
  ]);

  const attentionItems = [
    counts.failed > 0
      ? {
          key: "failed",
          label: "Failed runs",
          detail: "Review what went wrong.",
          value: counts.failed,
          href: "/runs",
          tone: "destructive" as const,
        }
      : null,
    counts.waitingForApproval > 0
      ? {
          key: "approvals",
          label: "Pending approvals",
          detail: "Waiting on a decision from you.",
          value: counts.waitingForApproval,
          href: "/approvals",
          tone: "warning" as const,
        }
      : null,
  ].filter((item) => item !== null);

  const overviewStats: { label: string; value: string; href: string }[] = [
    { label: "Agents", value: String(counts.agents), href: "/workflows" },
    { label: "Active runs", value: String(counts.running), href: "/runs" },
    { label: "Completed runs", value: String(counts.completed), href: "/runs" },
    {
      // Deliberately just a total here, not a breakdown — the per-run
      // detail (which agent, which category, prompt vs. completion) lives
      // at /runs, not on the dashboard.
      label: "Tokens used",
      value: totalTokens.toLocaleString(),
      href: "/runs",
    },
  ];

  const inboxFlash = typeof inboxProcessed === "string" && (
    <p className="text-sm text-muted-foreground">
      {inboxProcessed === "0"
        ? "No new emails."
        : `Routed ${inboxProcessed} new email${inboxProcessed === "1" ? "" : "s"} to an agent.`}
      {typeof inboxSkipped === "string" &&
        inboxSkipped !== "0" &&
        ` ${inboxSkipped} left unread — no agent's scope clearly matched.`}
    </p>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Overview</h1>
      </div>

      {(inboxFlash || inboxError) && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3">
          {inboxFlash}
          {typeof inboxError === "string" && (
            <p className="text-sm text-destructive">{inboxError}</p>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Needs your attention
        </h2>
        {attentionItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {attentionItems.map((item) => (
              <Link key={item.key} href={item.href}>
                <Card
                  className={cn(
                    "border-transparent ring-0 transition-colors",
                    item.tone === "destructive"
                      ? "bg-destructive/10 hover:bg-destructive/15"
                      : "bg-warning/10 hover:bg-warning/15",
                  )}
                >
                  <CardHeader className="pb-2">
                    <CardTitle
                      className={cn(
                        "text-sm font-medium",
                        item.tone === "destructive"
                          ? "text-destructive"
                          : "text-warning",
                      )}
                    >
                      {item.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p
                      className={cn(
                        "text-3xl font-semibold tabular-nums",
                        item.tone === "destructive"
                          ? "text-destructive"
                          : "text-warning",
                      )}
                    >
                      {item.value}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.detail}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="bg-success/5">
            <CardContent className="flex items-center gap-2 py-1">
              <p className="text-sm text-success">
                All clear — nothing failed and nothing is waiting on you.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Overview</h2>
        <Card>
          <CardContent className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {overviewStats.map((stat) => (
              <Link
                key={stat.label}
                href={stat.href}
                className="flex flex-col gap-1 px-4 py-3 transition-colors first:pl-0 last:pr-0 hover:bg-muted/50 sm:first:pl-4 sm:last:pr-4"
              >
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {stat.value}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Jump to</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {JUMP_TO.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Card className="h-full transition-colors hover:border-app-accent">
                  <CardHeader>
                    <div className="mb-1 flex size-8 items-center justify-center rounded-md bg-app-accent-soft text-app-accent-soft-foreground">
                      <Icon className="size-4" />
                    </div>
                    <CardTitle className="text-sm font-semibold">
                      {item.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {item.detail}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Connected inboxes
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              {emailIntegrations.length > 0
                ? "Routing incoming email to agents"
                : "No inbox connected"}
            </CardTitle>
            {emailIntegrations.length > 0 && (
              <CardAction>
                <form action={checkInboxAction}>
                  <Button type="submit" variant="outline">
                    Check inbox
                  </Button>
                </form>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {emailIntegrations.length > 0 ? (
              <div className="flex flex-col divide-y divide-border">
                {emailIntegrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                  >
                    <p className="text-sm">
                      {EMAIL_PROVIDER_LABELS[integration.provider] ??
                        integration.provider}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {integration.name}
                    </p>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">
                  Only reads mail routed into the Aperator label/folder, and
                  routes each email to whichever agent&apos;s description best
                  matches it — see Settings.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not connected.{" "}
                <Link
                  href="/settings/integrations"
                  className="text-primary hover:underline"
                >
                  Connect Gmail or Outlook in Settings
                </Link>{" "}
                to trigger agents from real email.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
