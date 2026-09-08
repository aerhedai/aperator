"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { Plus, Search } from "lucide-react";

import {
  disconnectAllAccountsAction,
  disconnectIntegrationAction,
  refreshMcpServerToolsAction,
} from "@/app/(shell)/(app)/settings/actions";
import { IntegrationIcon } from "@/components/settings/integration-icon";
import { McpServerConnectForm } from "@/components/settings/mcp-server-connect-form";
import { WebhookAccountForm } from "@/components/settings/webhook-account-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GMAIL_INBOX_LABEL } from "@/lib/integrations/gmail/client";
import {
  INTEGRATION_REGISTRY,
  type IntegrationProviderName,
} from "@/lib/integrations/integration-registry";
import { OUTLOOK_INBOX_FOLDER } from "@/lib/integrations/outlook/client";

const MCP_PROVIDER: IntegrationProviderName = "mcp";

// Every first-party integration a business can search for and connect.
// "mcp" is deliberately excluded — connecting a custom MCP server isn't
// "one account of a fixed provider," it's an open-ended list of distinct
// servers, so it gets its own always-visible action (AddMcpServerDialog)
// next to the search bar instead of competing for space in a searchable
// grid of fixed providers.
const SEARCHABLE_INTEGRATIONS = INTEGRATION_REGISTRY.filter(
  (entry) => entry.provider !== MCP_PROVIDER,
);
const MCP_REGISTRY_ENTRY = INTEGRATION_REGISTRY.find(
  (entry) => entry.provider === MCP_PROVIDER,
)!;

export interface DisplayAccount {
  id: string;
  name: string;
}

interface EntryProps {
  provider: string;
  label: string;
  description: string;
  connectionMode: "oauth" | "manual";
}

function ProviderSetupNotes({ provider }: { provider: string }) {
  if (provider === "gmail") {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p>
          Agents only ever read email labelled{" "}
          <span className="font-mono text-foreground">{GMAIL_INBOX_LABEL}</span>{" "}
          — never a connected account&rsquo;s whole inbox. One-time setup per
          account in Gmail:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>
            Create a label called{" "}
            <span className="font-mono text-foreground">
              {GMAIL_INBOX_LABEL}
            </span>
            .
          </li>
          <li>
            Pick a dedicated address customers send inquiries to (e.g. a{" "}
            <span className="font-mono text-foreground">+quotes</span> alias on
            this account).
          </li>
          <li>
            Create a Gmail filter matching that address that applies the label
            automatically.
          </li>
        </ol>
        <p className="mt-2">
          No manual labelling per email — Gmail applies it for you from then on.
        </p>
      </div>
    );
  }

  if (provider === "outlook") {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p>
          Agents only ever read email routed into the{" "}
          <span className="font-mono text-foreground">
            {OUTLOOK_INBOX_FOLDER}
          </span>{" "}
          folder — never a connected account&rsquo;s whole mailbox. One-time
          setup per account in Outlook:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>
            Create a folder called{" "}
            <span className="font-mono text-foreground">
              {OUTLOOK_INBOX_FOLDER}
            </span>
            .
          </li>
          <li>
            Pick a dedicated address customers send inquiries to (e.g. a{" "}
            <span className="font-mono text-foreground">+quotes</span> alias on
            this account).
          </li>
          <li>
            Create an Outlook inbox rule matching that address that moves mail
            into the folder automatically.
          </li>
        </ol>
        <p className="mt-2">
          No manual filing per email — Outlook applies it for you from then on.
        </p>
      </div>
    );
  }

  if (provider === "teams") {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p>
          Messages post as whichever person connects this account — not as a
          separate &ldquo;Aperator&rdquo; bot. A real bot identity would need
          Microsoft&rsquo;s separate Bot Service, which this doesn&rsquo;t use.
        </p>
        <p className="mt-2">
          To notify a specific channel, an agent needs that channel&rsquo;s team
          ID and channel ID — open the channel in Teams, use &ldquo;Get link to
          channel&rdquo;, and the IDs are in the copied URL.
        </p>
      </div>
    );
  }

  if (provider === "google-drive") {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p>
          Only sees files and folders Aperator itself creates — never this
          account&rsquo;s existing Drive. Which folder an agent archives into is
          set up separately, once that&rsquo;s configured for a workflow.
        </p>
      </div>
    );
  }

  if (provider === "sharepoint") {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p>
          Grants access to every SharePoint site this account can reach — the
          specific site an agent archives into is set up separately, once
          that&rsquo;s configured for a workflow. Narrower per-site access
          isn&rsquo;t available without knowing which site ahead of time.
        </p>
      </div>
    );
  }

  return null;
}

// Dispatches on the registry's declared connectionMode rather than a
// per-provider if-chain — "oauth" providers all render the same generic
// "Connect" link (the whole point of generalizing the flow: a third OAuth
// provider needs no change here at all). "manual" only ever needs
// WebhookAccountForm today; not abstracted further than that since there's
// still only one real manual-entry shape to support.
function ConnectOrAddAccount({
  provider,
  label,
  connectionMode,
  baseUrl,
}: EntryProps & { baseUrl: string }) {
  if (connectionMode === "oauth") {
    return (
      <Button
        nativeButton={false}
        render={<a href={`/api/integrations/${provider}/connect`} />}
      >
        Continue to {label} →
      </Button>
    );
  }
  if (provider === "webhook") {
    return <WebhookAccountForm baseUrl={baseUrl} />;
  }
  return null;
}

function AddIntegrationDialog({
  entry,
  baseUrl,
}: {
  entry: EntryProps;
  baseUrl: string;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button>Add +</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {entry.label}</DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>
        <ProviderSetupNotes provider={entry.provider} />
        <ConnectOrAddAccount {...entry} baseUrl={baseUrl} />
      </DialogContent>
    </Dialog>
  );
}

function ConfigureDialog({
  entry,
  accounts,
  baseUrl,
}: {
  entry: EntryProps;
  accounts: DisplayAccount[];
  baseUrl: string;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline">Configure</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry.label} accounts</DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span className="font-mono">{account.name}</span>
              <div className="flex items-center gap-2">
                <form
                  action={disconnectIntegrationAction.bind(null, account.id)}
                >
                  <Button type="submit" variant="outline" size="sm">
                    Disconnect
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </div>

        <ProviderSetupNotes provider={entry.provider} />

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">Add another account</p>
          <ConnectOrAddAccount {...entry} baseUrl={baseUrl} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemoveIntegrationSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Removing…" : "Remove integration"}
    </Button>
  );
}

function DeleteIntegrationDialog({
  entry,
  accountCount,
}: {
  entry: EntryProps;
  accountCount: number;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive">Delete</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {entry.label}?</DialogTitle>
          <DialogDescription>
            Disconnects all {accountCount} connected account
            {accountCount === 1 ? "" : "s"}. Any agent or workflow using{" "}
            {entry.label} will stop working until it&rsquo;s reconnected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <form action={disconnectAllAccountsAction.bind(null, entry.provider)}>
            <RemoveIntegrationSubmitButton />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationCard({
  entry,
  accounts,
  baseUrl,
}: {
  entry: EntryProps;
  accounts: DisplayAccount[];
  baseUrl: string;
}) {
  const isConnected = accounts.length > 0;

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <IntegrationIcon provider={entry.provider} />
          <div className="flex-1">
            <p className="font-medium">{entry.label}</p>
            {isConnected && (
              <p className="text-xs text-muted-foreground">
                {accounts.length} account{accounts.length === 1 ? "" : "s"}{" "}
                connected
              </p>
            )}
          </div>
        </div>

        {/* line-clamp fixes the card's text to a constant number of
            lines (never reflowing to more or fewer) so the card's own
            height stays put as the sidebar's collapse animation resizes
            this grid — without it, a description that wraps differently
            at each intermediate width makes every card visibly reflow
            mid-transition. */}
        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
          {entry.description}
        </p>

        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <>
              <ConfigureDialog
                entry={entry}
                accounts={accounts}
                baseUrl={baseUrl}
              />
              <DeleteIntegrationDialog
                entry={entry}
                accountCount={accounts.length}
              />
            </>
          ) : (
            <AddIntegrationDialog entry={entry} baseUrl={baseUrl} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Connecting a custom MCP server isn't "add another account of a known
// provider" — there's no fixed entry for it to occupy in the searchable
// grid above, just an open-ended list of distinct servers. This is that
// server's entry point instead: always visible next to the search bar,
// same connect form the old mcp card used.
function AddMcpServerDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Plus className="size-4" />
            Add MCP server
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect an MCP server</DialogTitle>
          <DialogDescription>
            {MCP_REGISTRY_ENTRY.description}
          </DialogDescription>
        </DialogHeader>
        <McpServerConnectForm />
      </DialogContent>
    </Dialog>
  );
}

// A flat list rather than the single-card-with-a-dialog pattern the fixed
// providers use above: each row here is a genuinely distinct server (its
// own URL and credentials), not an interchangeable "account" of one
// provider, so there's nothing to group behind a "Configure" dialog.
function ConnectedMcpServers({ accounts }: { accounts: DisplayAccount[] }) {
  if (accounts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Connected MCP servers</p>
      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
        >
          <span className="font-mono">{account.name}</span>
          <div className="flex items-center gap-2">
            <form action={refreshMcpServerToolsAction.bind(null, account.id)}>
              <Button type="submit" variant="outline" size="sm">
                Refresh tools
              </Button>
            </form>
            <form action={disconnectIntegrationAction.bind(null, account.id)}>
              <Button type="submit" variant="outline" size="sm">
                Disconnect
              </Button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}

export function IntegrationsSection({
  accountsByProvider,
  connectedProvider,
  errorMessage,
  baseUrl,
}: {
  accountsByProvider: Record<string, DisplayAccount[]>;
  connectedProvider?: string;
  errorMessage?: string;
  baseUrl: string;
}) {
  const [search, setSearch] = useState("");
  const connectedLabel = INTEGRATION_REGISTRY.find(
    (entry) => entry.provider === connectedProvider,
  )?.label;

  const filteredIntegrations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return SEARCHABLE_INTEGRATIONS;
    return SEARCHABLE_INTEGRATIONS.filter((entry) =>
      entry.label.toLowerCase().includes(query),
    );
  }, [search]);

  return (
    <div className="flex flex-col gap-4">
      {connectedLabel && (
        <p className="text-sm text-success">
          {connectedLabel} account connected.
        </p>
      )}
      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search integrations…"
            aria-label="Search integrations"
            className="pl-8"
          />
        </div>
        <AddMcpServerDialog />
      </div>

      {filteredIntegrations.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No integrations match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filteredIntegrations.map((entry) => (
            <IntegrationCard
              key={entry.provider}
              entry={entry}
              accounts={accountsByProvider[entry.provider] ?? []}
              baseUrl={baseUrl}
            />
          ))}
        </div>
      )}

      <ConnectedMcpServers accounts={accountsByProvider[MCP_PROVIDER] ?? []} />
    </div>
  );
}
