import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteEntityTypeDialog } from "@/components/entities/delete-entity-type-dialog";
import { EntityRecordTable } from "@/components/entities/entity-record-table";
import * as entityRecordService from "@/lib/entities/entity-record-service";
import * as entityTypeService from "@/lib/entities/entity-type-service";
import { entityFieldsSchema, type EntityFieldConfig } from "@/lib/entities/schemas";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

// The label shown for a referenced record — its target type's first
// non-reference field (a reasonable "name"-shaped default), falling back to
// the first field of any kind, and finally the record's own id.
function pickLabelField(fields: EntityFieldConfig[]): string | null {
  return (
    fields.find((f) => f.type !== "reference")?.name ??
    fields[0]?.name ??
    null
  );
}

export default async function EntityTypeDetailPage({
  params,
}: PageProps<"/catalog/[id]">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const entityType = await entityTypeService.getEntityType(organisation.id, id);

  if (!entityType) {
    notFound();
  }

  const fields = entityFieldsSchema.parse(entityType.fields);
  const records = await entityRecordService.listRecords(organisation.id, id);

  // Resolved once per referenced *type*, not per record or per cell — a
  // reference field's value is just an id, so rendering it as a clickable,
  // human-readable link needs the target type's own id (for the URL) and a
  // label for each of its records, gathered up front rather than doing a
  // lookup per row.
  const referenceFields = fields.filter((f) => f.type === "reference");
  const referenceTargets: Record<
    string,
    { entityTypeId: string; labels: Record<string, string> }
  > = {};
  if (referenceFields.length > 0) {
    const allTypes = await entityTypeService.listEntityTypes(organisation.id);
    const typesByName = new Map(allTypes.map((t) => [t.name, t]));

    for (const field of referenceFields) {
      if (field.type !== "reference") continue;
      const targetType = typesByName.get(field.recordType);
      if (!targetType) continue;

      const targetFields = entityFieldsSchema.parse(targetType.fields);
      const labelField = pickLabelField(targetFields);
      const targetRecords = await entityRecordService.listRecords(
        organisation.id,
        targetType.id,
      );

      const labels: Record<string, string> = {};
      for (const targetRecord of targetRecords) {
        const data = targetRecord.data as Record<string, unknown>;
        labels[targetRecord.id] = labelField
          ? String(data[labelField] ?? targetRecord.id)
          : targetRecord.id;
      }
      referenceTargets[field.name] = { entityTypeId: targetType.id, labels };
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{entityType.name}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/catalog/${id}/edit`} />}
          >
            Edit
          </Button>
          <Button
            nativeButton={false}
            render={<Link href={`/catalog/${id}/records/new`} />}
          >
            Add record
          </Button>
          <DeleteEntityTypeDialog
            id={id}
            name={entityType.name}
            recordCount={records.length}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fields
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {fields.map((field) => (
            <p key={field.name} className="text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {field.name}
              </span>{" "}
              <span className="text-muted-foreground">({field.type})</span> —{" "}
              {field.description}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EntityRecordTable
            entityTypeId={id}
            fields={fields}
            records={records.map((record) => ({
              id: record.id,
              data: record.data as Record<string, unknown>,
            }))}
            currencyCode={organisation.currency}
            referenceTargets={referenceTargets}
          />
        </CardContent>
      </Card>
    </div>
  );
}
