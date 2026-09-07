"use server";

import { revalidatePath } from "next/cache";

import { AIProviderNotConfiguredError } from "@/lib/ai/organisation-ai-provider";
import {
  EmbeddingUnavailableError,
  addDocument,
  deleteDocument,
} from "@/lib/knowledge/knowledge-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export type KnowledgeFormState = {
  error?: string;
  added?: { title: string; chunkCount: number };
};

const MAX_CHARS = 200_000;

export async function addKnowledgeDocumentAction(
  _prevState: KnowledgeFormState,
  formData: FormData,
): Promise<KnowledgeFormState> {
  const title = formData.get("title");
  const pasted = formData.get("content");
  const file = formData.get("file");

  // A file, when given, wins over the textarea — someone who picked a file
  // meant to upload it, even if the textarea still holds an earlier paste.
  let content = typeof pasted === "string" ? pasted : "";
  let derivedTitle = typeof title === "string" ? title.trim() : "";

  if (file instanceof File && file.size > 0) {
    // Text only for now. A .docx or .pdf needs a real extractor, and
    // silently indexing the raw bytes of one would produce chunks that
    // retrieve nothing and look like a mysterious quality problem later.
    const isText =
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".txt");
    if (!isText) {
      return {
        error:
          "Only plain text and Markdown files can be indexed right now — paste the content instead, or save the document as .txt.",
      };
    }
    content = await file.text();
    if (derivedTitle === "") derivedTitle = file.name;
  }

  if (derivedTitle === "") {
    return { error: "Give the document a title." };
  }
  if (content.trim() === "") {
    return { error: "Paste some text or choose a file to index." };
  }
  if (content.length > MAX_CHARS) {
    return {
      error: `That document is too large to index in one go (${content.length.toLocaleString()} characters, limit ${MAX_CHARS.toLocaleString()}). Split it into sections.`,
    };
  }

  const organisation = await getCurrentOrganisation();
  try {
    const { chunkCount } = await addDocument(organisation.id, {
      title: derivedTitle,
      content,
      source: file instanceof File && file.size > 0 ? "upload" : "pasted",
    });
    revalidatePath("/knowledge");
    return { added: { title: derivedTitle, chunkCount } };
  } catch (error) {
    // Both of these are ordinary setup states, not faults — a business
    // that hasn't connected an AI provider yet should be told that, not
    // shown a stack trace.
    if (
      error instanceof AIProviderNotConfiguredError ||
      error instanceof EmbeddingUnavailableError
    ) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function deleteKnowledgeDocumentAction(id: string) {
  const organisation = await getCurrentOrganisation();
  await deleteDocument(organisation.id, id);
  revalidatePath("/knowledge");
}
