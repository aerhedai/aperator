"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  deleteMyAccountAction,
  deleteOrganisationAction,
  updateLegalLinksAction,
  type DangerZoneFormState,
  type LegalLinksFormState,
} from "@/app/(shell)/(app)/settings/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function LegalLinksForm({
  termsUrl,
  privacyUrl,
}: {
  termsUrl: string | null;
  privacyUrl: string | null;
}) {
  const [state, formAction] = useActionState<LegalLinksFormState, FormData>(
    updateLegalLinksAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="termsUrl">Terms of Service URL</Label>
        <Input
          key={termsUrl}
          id="termsUrl"
          name="termsUrl"
          type="url"
          placeholder="https://…"
          defaultValue={termsUrl ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          Wherever you host your own Terms of Service — this app doesn&rsquo;t
          author legal text for you.
        </p>
        {state.fieldErrors?.termsUrl && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.termsUrl[0]}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="privacyUrl">Privacy Policy URL</Label>
        <Input
          key={privacyUrl}
          id="privacyUrl"
          name="privacyUrl"
          type="url"
          placeholder="https://…"
          defaultValue={privacyUrl ?? ""}
        />
        {state.fieldErrors?.privacyUrl && (
          <p className="text-sm text-destructive">
            {state.fieldErrors.privacyUrl[0]}
          </p>
        )}
      </div>

      <div>
        <SaveButton />
      </div>
    </form>
  );
}

function ConfirmDeleteButton({
  label,
  pendingLabel,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={disabled || pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function DeleteAccountDialog() {
  const [state, formAction] = useActionState<DangerZoneFormState, FormData>(
    deleteMyAccountAction,
    {},
  );
  const [value, setValue] = useState("");

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="destructive">Delete my account</Button>}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently deletes your personal sign-in and removes your
            access to this organisation. It does not delete the organisation
            itself or its data — an owner can still see everything you did here.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmDeleteAccount">
              Type <span className="font-mono">DELETE</span> to confirm
            </Label>
            <Input
              id="confirmDeleteAccount"
              name="confirmation"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <ConfirmDeleteButton
              label="Delete my account"
              pendingLabel="Deleting…"
              disabled={value !== "DELETE"}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteOrganisationDialog({
  organisationName,
}: {
  organisationName: string;
}) {
  const [state, formAction] = useActionState<DangerZoneFormState, FormData>(
    deleteOrganisationAction,
    {},
  );
  const [value, setValue] = useState("");

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="destructive">Delete this organisation</Button>}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {organisationName}?</DialogTitle>
          <DialogDescription>
            Permanently deletes every agent, run, approval, customer, product,
            and connected integration this organisation owns. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmDeleteOrg">
              Type <span className="font-mono">{organisationName}</span> to
              confirm
            </Label>
            <Input
              id="confirmDeleteOrg"
              name="confirmation"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <ConfirmDeleteButton
              label="Delete organisation"
              pendingLabel="Deleting…"
              disabled={value !== organisationName}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
