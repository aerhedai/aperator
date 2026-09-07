"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  createEntityTypeAction,
  updateEntityTypeAction,
  type EntityTypeFormState,
} from "@/app/(shell)/(app)/catalog/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_TYPES, type EntityFieldConfig } from "@/lib/entities/schemas";

interface FieldDraft {
  name: string;
  description: string;
  type: string;
  required: boolean;
  options: string;
  recordType: string;
}

function emptyField(): FieldDraft {
  return {
    name: "",
    description: "",
    type: "text",
    required: true,
    options: "",
    recordType: "",
  };
}

function toDraft(field: EntityFieldConfig): FieldDraft {
  return {
    name: field.name,
    description: field.description,
    type: field.type,
    required: field.required,
    options: field.type === "select" ? field.options.join(", ") : "",
    recordType: field.type === "reference" ? field.recordType : "",
  };
}

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  number: "Number",
  currency: "Currency",
  date: "Date",
  boolean: "Yes / no",
  select: "Choice list",
  reference: "Link to another type",
};

function SubmitButton({
  pendingLabel,
  label,
}: {
  pendingLabel: string;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function EntityTypeForm({
  editing,
}: {
  // Omitted: create mode. Present: edit mode, pre-filled and bound to
  // updateEntityTypeAction for this entity type's id.
  editing?: { id: string; name: string; fields: EntityFieldConfig[] };
} = {}) {
  // Draft rows, not parsed configs — a row being edited is legitimately
  // incomplete (no name yet, select with no options yet), so the form's
  // own state is deliberately looser than EntityFieldConfig and only
  // becomes one after the server parses it.
  const [state, formAction] = useActionState<EntityTypeFormState, FormData>(
    editing
      ? updateEntityTypeAction.bind(null, editing.id)
      : createEntityTypeAction,
    {},
  );
  const [fields, setFields] = useState<FieldDraft[]>(
    editing?.fields.map(toDraft) ?? [emptyField()],
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Property"
          defaultValue={editing?.name}
          required
        />
        {state.fieldErrors?.name && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Fields</Label>
        <p className="text-xs text-muted-foreground">
          What a record of this type looks like. An agent category can be
          configured to look one of these up by any of its fields.
        </p>
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          {fields.map((field, index) => {
            const update = (patch: Partial<FieldDraft>) =>
              setFields((f) =>
                f.map((item, i) =>
                  i === index ? { ...item, ...patch } : item,
                ),
              );
            return (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border/60 p-2"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    name="fieldName"
                    placeholder="Field name, e.g. address"
                    value={field.name}
                    onChange={(e) => update({ name: e.target.value })}
                    className="sm:w-44"
                  />
                  <Input
                    name="fieldDescription"
                    placeholder="What it is, e.g. the property's full address"
                    value={field.description}
                    onChange={(e) => update({ description: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setFields((f) => f.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    name="fieldType"
                    value={field.type}
                    onChange={(e) => update({ type: e.target.value })}
                    className="h-9 rounded-md border border-border bg-transparent px-2 text-sm sm:w-44"
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type] ?? type}
                      </option>
                    ))}
                  </select>
                  {/* A select rather than a checkbox: an unchecked checkbox
                      submits nothing, which would break the index alignment
                      every field row depends on. */}
                  <select
                    name="fieldRequired"
                    value={field.required ? "required" : "optional"}
                    onChange={(e) =>
                      update({ required: e.target.value === "required" })
                    }
                    className="h-9 rounded-md border border-border bg-transparent px-2 text-sm sm:w-36"
                  >
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                  </select>
                  {/* Always rendered, hidden when not applicable, so every
                      row submits every input and the parallel arrays stay
                      aligned by index. */}
                  <Input
                    name="fieldOptions"
                    placeholder="Choices, comma-separated e.g. Open, Closed"
                    value={field.options}
                    onChange={(e) => update({ options: e.target.value })}
                    className={field.type === "select" ? "flex-1" : "hidden"}
                  />
                  <Input
                    name="fieldRecordType"
                    placeholder="Type it links to, e.g. Customer"
                    value={field.recordType}
                    onChange={(e) => update({ recordType: e.target.value })}
                    className={field.type === "reference" ? "flex-1" : "hidden"}
                  />
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setFields((f) => [...f, emptyField()])}
          >
            Add field
          </Button>
        </div>
        {state.fieldErrors?.fields && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.fields[0]}
          </p>
        )}
      </div>

      <SubmitButton
        label={editing ? "Save changes" : "Create entity type"}
        pendingLabel={editing ? "Saving…" : "Creating…"}
      />
    </form>
  );
}
