"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createApiConnectionAction,
  type ApiConnectionFormState,
} from "@/app/(shell)/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Connecting…" : "Connect"}
    </Button>
  );
}

export function ApiConnectForm() {
  const [state, formAction] = useActionState<ApiConnectionFormState, FormData>(
    createApiConnectionAction,
    {},
  );

  if (state.connected) {
    return (
      <p className="text-sm text-success">
        Connected — grant its call_api tool to a worker from the worker editor.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="apiLabel">Label</Label>
        <Input
          id="apiLabel"
          name="label"
          placeholder="e.g. Meta Graph API"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="apiBaseUrl">Base URL</Label>
        <Input
          id="apiBaseUrl"
          name="baseUrl"
          type="url"
          placeholder="https://graph.facebook.com/v19.0/"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="apiToken">Bearer token</Label>
        <Input id="apiToken" name="token" type="password" required />
      </div>
      <p className="text-xs text-muted-foreground">
        Every request a granted worker makes is sent to this base URL only, with
        this token attached as an Authorization header — the worker never sees
        or sets it directly.
      </p>
      <SubmitButton />
    </form>
  );
}
