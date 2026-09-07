"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as entityRecordService from "@/lib/entities/entity-record-service";
import type { Prisma } from "@/lib/generated/prisma/client";
import * as entityTypeService from "@/lib/entities/entity-type-service";
import {
  buildRecordDataSchema,
  entityFieldsSchema,
} from "@/lib/entities/schemas";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export type RecordFormState = {
  error?: string;
  // string[] | undefined, not just string[] — this schema's shape is
  // built dynamically per entity type (buildRecordDataSchema), so Zod
  // can't narrow it to a finite known key set the way a static schema's
  // flatten() result would be.
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function createRecordAction(
  entityTypeId: string,
  _prevState: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const organisation = await getCurrentOrganisation();
  const entityType = await entityTypeService.getEntityType(
    organisation.id,
    entityTypeId,
  );
  if (!entityType) {
    notFound();
  }

  // The record's shape is only known once the entity type's own fields
  // are — this schema is built per-request, not a static import, the same
  // reasoning as acknowledge-reply-pipeline.ts's dynamic extraction schema.
  const fields = entityFieldsSchema.parse(entityType.fields);
  const schema = buildRecordDataSchema(fields);

  const raw: Record<string, string> = {};
  for (const field of fields) {
    raw[field.name] = String(formData.get(field.name) ?? "");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await entityRecordService.createRecord(
    organisation.id,
    entityTypeId,
    // buildRecordDataSchema's per-type transforms (currency rounding,
    // date -> ISO) widen the parsed result, so the same InputJsonValue
    // cast the repository layer already uses applies here too.
    parsed.data as Prisma.InputJsonValue,
  );
  redirect(`/catalog/${entityTypeId}`);
}

export async function deleteRecordAction(
  entityTypeId: string,
  recordId: string,
) {
  const organisation = await getCurrentOrganisation();
  const deleted = await entityRecordService.deleteRecord(
    organisation.id,
    recordId,
  );
  if (!deleted) {
    notFound();
  }
  revalidatePath(`/catalog/${entityTypeId}`);
}

export async function updateRecordAction(
  entityTypeId: string,
  recordId: string,
  _prevState: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const organisation = await getCurrentOrganisation();
  const entityType = await entityTypeService.getEntityType(
    organisation.id,
    entityTypeId,
  );
  if (!entityType) {
    notFound();
  }

  const fields = entityFieldsSchema.parse(entityType.fields);
  const schema = buildRecordDataSchema(fields);

  const raw: Record<string, string> = {};
  for (const field of fields) {
    raw[field.name] = String(formData.get(field.name) ?? "");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const updated = await entityRecordService.updateRecord(
    organisation.id,
    recordId,
    parsed.data,
  );
  if (!updated) {
    notFound();
  }
  redirect(`/catalog/${entityTypeId}`);
}
