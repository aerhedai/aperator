"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as entityTypeService from "@/lib/entities/entity-type-service";
import { entityTypeInputSchema } from "@/lib/entities/schemas";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export type EntityTypeFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function text(value: FormDataEntryValue | undefined): string {
  return typeof value === "string" ? value : "";
}

// Shared by create and update — both forms submit the same repeated-input
// shape (see EntityTypeForm), zipped by index. Every field row submits
// every input, including the ones its type doesn't use, so the arrays stay
// index-aligned; a checkbox would break that alignment by not submitting
// when unchecked, which is why `required` is a select rather than a
// checkbox here (same lesson as the pipeline config form).
function parseEntityTypeFormData(formData: FormData) {
  const names = formData.getAll("fieldName");
  const descriptions = formData.getAll("fieldDescription");
  const types = formData.getAll("fieldType");
  const requireds = formData.getAll("fieldRequired");
  const options = formData.getAll("fieldOptions");
  const recordTypes = formData.getAll("fieldRecordType");

  const fields = names.map((name, i) => {
    const type = text(types[i]) || "text";
    const base = {
      name: text(name),
      description: text(descriptions[i]),
      type,
      required: text(requireds[i]) !== "optional",
    };
    if (type === "select") {
      return {
        ...base,
        // Comma-separated in one input, same convention as the agent
        // form's keyword lists.
        options: text(options[i])
          .split(",")
          .map((option) => option.trim())
          .filter((option) => option.length > 0),
      };
    }
    if (type === "reference") {
      return { ...base, recordType: text(recordTypes[i]) };
    }
    return base;
  });

  return entityTypeInputSchema.safeParse({
    name: formData.get("name"),
    fields,
  });
}

export async function createEntityTypeAction(
  _prevState: EntityTypeFormState,
  formData: FormData,
): Promise<EntityTypeFormState> {
  const parsed = parseEntityTypeFormData(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const organisation = await getCurrentOrganisation();
  let entityTypeId: string;
  try {
    const entityType = await entityTypeService.createEntityType(
      organisation.id,
      parsed.data,
    );
    entityTypeId = entityType.id;
  } catch {
    return { error: "An entity type with that name already exists." };
  }
  redirect(`/catalog/${entityTypeId}`);
}

// Existing records keep whatever data they already have under a field
// that's since been removed or renamed here — same "data outlives schema"
// behavior already used throughout the custom-entity system (e.g.
// updateRecordData's merge semantics), rather than trying to migrate or
// strip existing record data to match the edited field list.
export async function updateEntityTypeAction(
  id: string,
  _prevState: EntityTypeFormState,
  formData: FormData,
): Promise<EntityTypeFormState> {
  const parsed = parseEntityTypeFormData(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const organisation = await getCurrentOrganisation();
  let updated: boolean;
  try {
    updated = await entityTypeService.updateEntityType(
      organisation.id,
      id,
      parsed.data,
    );
  } catch {
    return { error: "An entity type with that name already exists." };
  }
  if (!updated) {
    notFound();
  }
  redirect(`/catalog/${id}`);
}

// Cascades to every record of this type — see schema.prisma's
// onDelete: Cascade comment.
export async function deleteEntityTypeAction(id: string) {
  const organisation = await getCurrentOrganisation();
  const deleted = await entityTypeService.deleteEntityType(organisation.id, id);
  if (!deleted) {
    notFound();
  }
  revalidatePath("/catalog");
  redirect("/catalog");
}
