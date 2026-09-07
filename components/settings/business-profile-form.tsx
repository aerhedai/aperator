"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { updateBusinessProfileAction } from "@/app/(shell)/(app)/settings/actions";
import type { BusinessProfileFormState } from "@/app/(shell)/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUPPORTED_CURRENCIES } from "@/lib/currency/currency-symbols";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function BusinessProfileForm({
  name,
  currency,
}: {
  name: string;
  currency: string;
}) {
  const [state, formAction] = useActionState<
    BusinessProfileFormState,
    FormData
  >(updateBusinessProfileAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Business name</Label>
        <Input id="name" name="name" defaultValue={name} required />
        <p className="text-xs text-muted-foreground">
          Used in the sign-off of every reply an agent composes (e.g. &ldquo;The{" "}
          {name} team&rdquo;).
        </p>
        {state.fieldErrors?.name && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="currency">Currency</Label>
        <select
          id="currency"
          name="currency"
          defaultValue={currency}
          className="h-9 rounded-md border border-border bg-transparent px-3 text-sm"
        >
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {state.fieldErrors?.currency && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.currency[0]}
          </p>
        )}
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
