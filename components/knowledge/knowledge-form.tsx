"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  addKnowledgeDocumentAction,
  deleteKnowledgeDocumentAction,
  type KnowledgeFormState,
} from "@/app/(shell)/(app)/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {/* Indexing embeds every chunk, so this is genuinely slower than a
          normal form submit — saying so beats a button that looks stuck. */}
      {pending ? "Indexing…" : "Add to knowledge"}
    </Button>
  );
}

export function AddKnowledgeForm() {
  const [state, formAction] = useActionState<KnowledgeFormState, FormData>(
    addKnowledgeDocumentAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.added && (
        <p className="text-sm text-success">
          Indexed &ldquo;{state.added.title}&rdquo; as {state.added.chunkCount}{" "}
          searchable {state.added.chunkCount === 1 ? "passage" : "passages"}.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. Returns and Refunds Policy"
        />
        <p className="text-xs text-muted-foreground">
          What this document is. Agents see it alongside each retrieved passage,
          so it&rsquo;s worth being specific.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="content">Paste the text</Label>
        <textarea
          id="content"
          name="content"
          rows={10}
          placeholder="Paste a policy, procedure, price list, or FAQ…"
          className="w-full rounded-md border border-border bg-transparent p-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="file">Or upload a file</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
        />
        <p className="text-xs text-muted-foreground">
          Plain text and Markdown for now. A file takes priority over pasted
          text, and its filename becomes the title if you leave that blank.
        </p>
      </div>

      <SubmitButton />
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}

export function DeleteKnowledgeDocument({ id }: { id: string }) {
  return (
    <form action={deleteKnowledgeDocumentAction.bind(null, id)}>
      <DeleteButton />
    </form>
  );
}
