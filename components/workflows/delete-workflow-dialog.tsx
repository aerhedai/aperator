"use client";

import { useFormStatus } from "react-dom";

import { deleteWorkflowAction } from "@/app/(shell)/(app)/workflows/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function DeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Deleting…" : "Delete workflow"}
    </Button>
  );
}

export function DeleteWorkflowDialog({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive">Delete</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>This can&rsquo;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <form action={deleteWorkflowAction.bind(null, id)}>
            <DeleteSubmitButton />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
