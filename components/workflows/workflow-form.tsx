"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  createWorkflowAction,
  type WorkflowFormState,
} from "@/app/(shell)/(app)/workflows/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TriggerType = "EMAIL" | "WEBHOOK";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create department"}
    </Button>
  );
}

export function WorkflowForm({
  webhookIntegrations = [],
  gmailIntegrations = [],
}: {
  // Offered as the required trigger account when WEBHOOK is selected —
  // there's no generic webhook URL, only per-account ones, so this list
  // being empty means "connect a webhook account from Settings first."
  webhookIntegrations?: { id: string; name: string }[];
  // Offered as the optional trigger account when EMAIL is selected — left
  // unset, this workflow uses the organisation's default email account
  // (today's only behavior before this field existed).
  gmailIntegrations?: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<WorkflowFormState, FormData>(
    createWorkflowAction,
    {},
  );
  const [trigger, setTrigger] = useState<TriggerType>("EMAIL");
  const accountOptions =
    trigger === "WEBHOOK" ? webhookIntegrations : gmailIntegrations;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Invoice Processing"
          required
        />
        {state.fieldErrors?.name && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="What this department is for"
          required
        />
        {state.fieldErrors?.description && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.description[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="trigger">Trigger</Label>
        <select
          id="trigger"
          name="trigger"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value as TriggerType)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="EMAIL">Email</option>
          <option value="WEBHOOK">Webhook</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Webhook lets anything that can send a JSON POST (a form backend,
          Zapier, another internal system) trigger this department. More
          triggers (Slack, forms) are on the way. This department starts as a
          draft: build it out by adding a classifier and handler workers, then
          activate it when it&rsquo;s ready to receive real traffic.
        </p>
        {state.fieldErrors?.trigger && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.trigger[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="triggerIntegrationId">
          {trigger === "WEBHOOK" ? "Webhook account" : "Email account"}
        </Label>
        <select
          id="triggerIntegrationId"
          name="triggerIntegrationId"
          defaultValue=""
          required={trigger === "WEBHOOK"}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="" disabled={trigger === "WEBHOOK"}>
            {trigger === "WEBHOOK"
              ? "Select a connected webhook account…"
              : "Organisation's default email account"}
          </option>
          {accountOptions.map((integration) => (
            <option key={integration.id} value={integration.id}>
              {integration.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {trigger === "WEBHOOK" ? (
            accountOptions.length === 0 ? (
              <>
                No webhook accounts connected yet — add one from Settings →
                Integrations, then come back here.
              </>
            ) : (
              <>
                Exactly which webhook URL/secret triggers this department. Each
                connected account can only be bound to one active department at
                a time.
              </>
            )
          ) : (
            <>
              Optional. Leave as default unless this business has connected more
              than one Gmail account and this department should only listen on
              one of them.
            </>
          )}
        </p>
        {state.fieldErrors?.triggerIntegrationId && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.triggerIntegrationId[0]}
          </p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
