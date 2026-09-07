"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createRecordAction,
  updateRecordAction,
  type RecordFormState,
} from "@/app/(shell)/(app)/catalog/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EntityFieldConfig } from "@/lib/entities/schemas";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function EntityRecordForm({
  entityTypeId,
  fields,
  editing,
}: {
  entityTypeId: string;
  fields: EntityFieldConfig[];
  // Omitted: create mode. Present: edit mode, pre-filled and bound to
  // updateRecordAction for this record's id.
  editing?: { recordId: string; data: Record<string, unknown> };
}) {
  const [state, formAction] = useActionState<RecordFormState, FormData>(
    editing
      ? updateRecordAction.bind(null, entityTypeId, editing.recordId)
      : createRecordAction.bind(null, entityTypeId),
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-2">
          <Label htmlFor={field.name}>{field.name}</Label>
          <Input
            id={field.name}
            name={field.name}
            placeholder={field.description}
            defaultValue={
              editing?.data[field.name] !== undefined
                ? String(editing.data[field.name])
                : undefined
            }
            required
          />
          {state.fieldErrors?.[field.name]?.[0] && (
            <p className="text-sm text-destructive">
              {state.fieldErrors[field.name]?.[0]}
            </p>
          )}
        </div>
      ))}

      <SubmitButton label={editing ? "Save changes" : "Add record"} />
    </form>
  );
}
