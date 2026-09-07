"use client";

import { useFormStatus } from "react-dom";

import { deleteEntityTypeAction } from "@/app/(shell)/(app)/catalog/actions";
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
      {pending ? "Deleting…" : "Delete entity type"}
    </Button>
  );
}

export function DeleteEntityTypeDialog({
  id,
  name,
  recordCount,
}: {
  id: string;
  name: string;
  recordCount: number;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive">Delete</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            Also deletes all {recordCount} record{recordCount === 1 ? "" : "s"}{" "}
            of this type. Any agent or workflow configured to look this type up
            will fail clearly rather than find nothing — reconfigure them first
            if they&rsquo;re still in use. This can&rsquo;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <form action={deleteEntityTypeAction.bind(null, id)}>
            <DeleteSubmitButton />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
