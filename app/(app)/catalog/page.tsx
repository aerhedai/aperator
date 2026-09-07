import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { entityFieldsSchema } from "@/lib/entities/schemas";
import * as entityTypeService from "@/lib/entities/entity-type-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function EntityTypesPage() {
  const organisation = await getCurrentOrganisation();
  const entityTypes = await entityTypeService.listEntityTypes(organisation.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Catalog</h1>
          <p className="text-sm text-muted-foreground">
            Your own data — Products, Cases, Properties, whatever this business
            works with. Agents read it with find_record and search_records.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/catalog/new" />}>
          Create record type
        </Button>
      </div>

      {entityTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No record types yet. Create one to give your agents something to look
          up.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entityTypes.map((entityType) => {
            // Parsed defensively — a type saved before typed fields existed
            // still normalises to "text" per entityFieldSchema's preprocess,
            // so this never throws on older data.
            const fields = entityFieldsSchema.safeParse(entityType.fields);
            return (
              <Link key={entityType.id} href={`/catalog/${entityType.id}`}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-2 py-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{entityType.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {entityType._count.records} record
                        {entityType._count.records === 1 ? "" : "s"}
                      </span>
                    </div>
                    {fields.success && (
                      <div className="flex flex-wrap gap-1.5">
                        {fields.data.map((field) => (
                          <Badge key={field.name} variant="outline">
                            {field.name}
                            <span className="text-muted-foreground">
                              {" "}
                              {field.type}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
