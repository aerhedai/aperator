"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  createWebhookAccountAction,
  type WebhookAccountFormState,
} from "@/app/(shell)/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create"}
    </Button>
  );
}

export function WebhookAccountForm({ baseUrl }: { baseUrl: string }) {
  const [state, formAction] = useActionState<WebhookAccountFormState, FormData>(
    createWebhookAccountAction,
    {},
  );
  const [dismissed, setDismissed] = useState(false);

  if (state.created && !dismissed) {
    const url = `${baseUrl}/api/webhooks/${state.created.integrationId}`;
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <p className="font-medium">
          Save this now — the secret can&rsquo;t be shown again after you leave
          this page.
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="webhookUrl">URL</Label>
          <Input
            id="webhookUrl"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="webhookSecret">
            Secret — send as header{" "}
            <span className="font-mono">
              Authorization: Bearer &lt;secret&gt;
            </span>
          </Label>
          <Input
            id="webhookSecret"
            readOnly
            value={state.created.secret}
            onFocus={(e) => e.target.select()}
            className="font-mono text-xs"
          />
        </div>
        <p className="text-muted-foreground">
          POST JSON to this URL as{" "}
          <span className="font-mono text-foreground">
            {`{"body": "...", "subject": "...", "senderEmail": "..."}`}
          </span>{" "}
          — only <span className="font-mono text-foreground">body</span> is
          required.
        </p>
        <Button
          type="button"
          onClick={() => setDismissed(true)}
          className="self-start"
        >
          I&rsquo;ve saved it
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="webhookName">Account name</Label>
          <Input
            id="webhookName"
            name="name"
            placeholder="e.g. Website contact form"
            required
          />
        </div>
        <SubmitButton />
      </div>
    </form>
  );
}
