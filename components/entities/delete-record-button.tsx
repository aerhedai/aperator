"use client";

import { useFormStatus } from "react-dom";

import { deleteRecordAction } from "@/app/(shell)/(app)/catalog/[id]/actions";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}

export function DeleteRecordButton({
  entityTypeId,
  recordId,
}: {
  entityTypeId: string;
  recordId: string;
}) {
  return (
    <form action={deleteRecordAction.bind(null, entityTypeId, recordId)}>
      <SubmitButton />
    </form>
  );
}
