"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  disconnectProviderAction,
  saveGeminiProviderAction,
  saveOllamaProviderAction,
  saveOpenRouterProviderAction,
  setActiveProviderAction,
  type AIProviderFormState,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AIProviderKind,
  AIProviderStatus,
} from "@/lib/ai/organisation-ai-provider";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

function SmallButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ActiveBadge() {
  return (
    <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
      Active
    </span>
  );
}

/**
 * One provider's connect/disconnect/activate controls. `fields` renders
 * whatever that provider needs (Ollama: base URL + proxy secret; Gemini:
 * an API key) — the surrounding connected/active chrome is identical for
 * both, so it isn't duplicated per provider.
 */
function ProviderCard({
  title,
  description,
  kind,
  connectedAt,
  connectedDetail,
  isActive,
  saveAction,
  fields,
}: {
  title: string;
  description: string;
  kind: AIProviderKind;
  connectedAt: Date | null;
  // Non-secret detail worth showing alongside "Connected" — the base URL
  // for Ollama. Omitted for a provider with nothing non-secret to show.
  connectedDetail?: string;
  isActive: boolean;
  saveAction: (
    prevState: AIProviderFormState,
    formData: FormData,
  ) => Promise<AIProviderFormState>;
  fields: React.ReactNode;
}) {
  const [state, formAction] = useActionState<AIProviderFormState, FormData>(
    saveAction,
    {},
  );
  const isConnected = connectedAt !== null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {isActive && <ActiveBadge />}
        </div>
        {isConnected && !isActive && (
          <form action={setActiveProviderAction.bind(null, kind)}>
            <SmallButton label="Make active" pendingLabel="Activating…" />
          </form>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">{description}</p>

        {isConnected && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/40 p-3 text-sm">
            <p className="text-muted-foreground">
              Connected
              {connectedDetail && (
                <>
                  {" — "}
                  {connectedDetail}
                </>
              )}{" "}
              — updated {connectedAt!.toLocaleDateString("en-GB")}
            </p>
            <form action={disconnectProviderAction.bind(null, kind)}>
              <SmallButton
                label="Disconnect"
                pendingLabel="Disconnecting…"
                variant="outline"
              />
            </form>
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.saved && <p className="text-sm text-success">Saved.</p>}
          {fields}
          <div>
            <SaveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function AIProviderForm({ status }: { status: AIProviderStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <ProviderCard
        title="Ollama"
        description="A model you host yourself — free to run, but only reachable while your machine is on and connected."
        kind="ollama"
        connectedAt={status.ollama?.connectedAt ?? null}
        connectedDetail={status.ollama?.baseUrl}
        isActive={status.active === "ollama"}
        saveAction={saveOllamaProviderAction}
        fields={
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                name="baseUrl"
                type="url"
                placeholder="https://your-host:11434"
                defaultValue={status.ollama ? undefined : ""}
                required
              />
              <p className="text-xs text-muted-foreground">
                Where this organisation&rsquo;s Ollama instance is reachable —
                plain <span className="font-mono">http://localhost:11434</span>{" "}
                for local dev, or the auth proxy URL for a hosted deployment.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proxySecret">Proxy secret (optional)</Label>
              <Input
                id="proxySecret"
                name="proxySecret"
                type="password"
                placeholder={
                  status.ollama ? "Unchanged — leave blank to keep it" : ""
                }
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Only needed if the base URL points at an auth-gated proxy in
                front of Ollama, not plain local Ollama.
              </p>
            </div>
          </>
        }
      />

      <ProviderCard
        title="Gemini"
        description="Google's hosted API. No machine to keep running — a run here doesn't depend on anything at your end being online. Does not support Knowledge search: while Gemini is active, search_knowledge and any Retrieve step fail outright, not silently — switch back to Ollama to restore them."
        kind="gemini"
        connectedAt={status.gemini?.connectedAt ?? null}
        isActive={status.active === "gemini"}
        saveAction={saveGeminiProviderAction}
        fields={
          <div className="flex flex-col gap-2">
            <Label htmlFor="gemini-apiKey">API key</Label>
            <Input
              id="gemini-apiKey"
              name="apiKey"
              type="password"
              placeholder={
                status.gemini ? "Unchanged — leave blank to keep it" : ""
              }
              autoComplete="off"
              required={!status.gemini}
            />
            <p className="text-xs text-muted-foreground">
              From <span className="font-mono">aistudio.google.com/apikey</span>
              . Set each agent&rsquo;s Model field to a Gemini model name (e.g.{" "}
              <span className="font-mono">gemini-2.5-flash-lite</span>) before
              making this active — an agent still set to an Ollama model name
              will fail every run against Gemini.
            </p>
          </div>
        }
      />

      <ProviderCard
        title="OpenRouter"
        description="One hosted API key, hundreds of models from many providers. No machine to keep running — a run here doesn't depend on anything at your end being online."
        kind="openrouter"
        connectedAt={status.openrouter?.connectedAt ?? null}
        isActive={status.active === "openrouter"}
        saveAction={saveOpenRouterProviderAction}
        fields={
          <div className="flex flex-col gap-2">
            <Label htmlFor="openrouter-apiKey">API key</Label>
            <Input
              id="openrouter-apiKey"
              name="apiKey"
              type="password"
              placeholder={
                status.openrouter ? "Unchanged — leave blank to keep it" : ""
              }
              autoComplete="off"
              required={!status.openrouter}
            />
            <p className="text-xs text-muted-foreground">
              From <span className="font-mono">openrouter.ai/keys</span>. Set
              each agent&rsquo;s Model field to the exact OpenRouter model id
              (e.g. <span className="font-mono">upstage/solar-pro4</span>)
              before making this active — an agent still set to another
              provider&rsquo;s model name will fail every run against
              OpenRouter.
            </p>
          </div>
        }
      />
    </div>
  );
}
