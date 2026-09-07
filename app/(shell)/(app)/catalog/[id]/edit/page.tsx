import { notFound } from "next/navigation";

import { EntityTypeForm } from "@/components/entities/entity-type-form";
import * as entityTypeService from "@/lib/entities/entity-type-service";
import { entityFieldsSchema } from "@/lib/entities/schemas";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export default async function EditEntityTypePage({
  params,
}: PageProps<"/catalog/[id]/edit">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const entityType = await entityTypeService.getEntityType(organisation.id, id);

  if (!entityType) {
    notFound();
  }

  const fields = entityFieldsSchema.parse(entityType.fields);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Edit {entityType.name}</h1>
      <EntityTypeForm editing={{ id, name: entityType.name, fields }} />
    </div>
  );
}
