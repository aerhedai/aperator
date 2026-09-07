"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { RunAgentFormState } from "@/app/(shell)/(app)/agents/[id]/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Running…" : "Run agent"}
    </Button>
  );
}

export function RunAgentForm({
  action,
}: {
  action: (
    prevState: RunAgentFormState,
    formData: FormData,
  ) => Promise<RunAgentFormState>;
}) {
  const [state, formAction] = useActionState<RunAgentFormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Textarea
        name="input"
        placeholder="e.g. Customer ABC wants 500 units of Product A"
        rows={3}
        required
      />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
