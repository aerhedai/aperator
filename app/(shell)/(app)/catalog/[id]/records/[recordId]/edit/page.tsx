import { notFound } from "next/navigation";

import { EntityRecordForm } from "@/components/entities/entity-record-form";
import * as entityRecordService from "@/lib/entities/entity-record-service";
import * as entityTypeService from "@/lib/entities/entity-type-service";
import { entityFieldsSchema } from "@/lib/entities/schemas";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export default async function EditEntityRecordPage({
  params,
}: PageProps<"/catalog/[id]/records/[recordId]/edit">) {
  const { id, recordId } = await params;
  const organisation = await getCurrentOrganisation();
  const [entityType, record] = await Promise.all([
    entityTypeService.getEntityType(organisation.id, id),
    entityRecordService.getRecord(organisation.id, recordId),
  ]);

  if (!entityType || !record) {
    notFound();
  }

  const fields = entityFieldsSchema.parse(entityType.fields);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Edit {entityType.name} record</h1>
      <EntityRecordForm
        entityTypeId={id}
        fields={fields}
        editing={{
          recordId,
          data: record.data as Record<string, unknown>,
        }}
      />
    </div>
  );
}
