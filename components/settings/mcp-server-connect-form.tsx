"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createMcpServerAccountAction,
  type McpServerFormState,
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

export function McpServerConnectForm() {
  const [state, formAction] = useActionState<McpServerFormState, FormData>(
    createMcpServerAccountAction,
    {},
  );

  if (state.connected) {
    return (
      <p className="text-sm text-success">
        Connected — {state.connected.toolCount} tool
        {state.connected.toolCount === 1 ? "" : "s"} discovered and ready to
        grant to your agents.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="mcpLabel">Label</Label>
        <Input id="mcpLabel" name="label" placeholder="e.g. Notion" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mcpUrl">Server URL</Label>
        <Input
          id="mcpUrl"
          name="url"
          type="url"
          placeholder="https://example.com/mcp"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mcpToken">Bearer token</Label>
        <Input id="mcpToken" name="token" type="password" required />
      </div>
      <SubmitButton />
    </form>
  );
}
