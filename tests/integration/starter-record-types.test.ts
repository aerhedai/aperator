import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { entityTypeInputSchema } from "@/lib/entities/schemas";
import { seedStarterRecordTypes } from "@/lib/records/starter-record-type-service";
import { STARTER_RECORD_TYPES } from "@/lib/records/starter-record-types";

const MIGRATION =
  "prisma/migrations/20260904020000_collapse_catalog_into_record_types/migration.sql";

describe("starter record types", () => {
  const organisationId = "test-org-starter-types";

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Starter Types Org",
        currency: "GBP",
      },
    });
  });

  afterAll(async () => {
    await prisma.customEntityRecord.deleteMany({ where: { organisationId } });
    await prisma.customEntityType.deleteMany({ where: { organisationId } });
    await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("defines types the record layer would actually accept", () => {
    for (const definition of STARTER_RECORD_TYPES) {
      const result = entityTypeInputSchema.safeParse(definition);
      expect(
        result.success,
        `${definition.name}: ${result.success ? "" : result.error.issues.map((i) => i.message).join("; ")}`,
      ).toBe(true);
    }
  });

  it("matches the field definitions the collapse migration wrote", () => {
    // Organisations that existed at the collapse got these types from the
    // migration's hardcoded JSON; ones created since get them from the code
    // above. If the two drift, two businesses end up with types of the same
    // name and different shapes, and nothing else would catch it. Scoped to
    // just Product/Customer — the only two types that existed at the
    // collapse; anything added to STARTER_RECORD_TYPES since (Lead,
    // Booking, ...) was never part of that migration and has nothing to
    // match here.
    const sql = readFileSync(MIGRATION, "utf8");
    const collapseTypes = STARTER_RECORD_TYPES.filter((d) =>
      ["Product", "Customer"].includes(d.name),
    );
    for (const definition of collapseTypes) {
      const match = sql.match(
        new RegExp(`'${definition.name}', '(\\[.*?\\])'::jsonb`, "s"),
      );
      expect(
        match,
        `no ${definition.name} insert found in the migration`,
      ).not.toBeNull();
      // The migration escapes single quotes for SQL; undo that before parsing.
      const fields = JSON.parse(match![1]!.replace(/''/g, "'"));
      expect(fields).toEqual(definition.fields);
    }
  });

  it("seeds both types, and adding them twice doesn't duplicate", async () => {
    const first = await seedStarterRecordTypes(organisationId, [
      "Product",
      "Customer",
    ]);
    expect(first.sort()).toEqual(["Customer", "Product"]);

    const second = await seedStarterRecordTypes(organisationId, [
      "Product",
      "Customer",
    ]);
    expect(second).toEqual([]);

    const count = await prisma.customEntityType.count({
      where: { organisationId, name: { in: ["Product", "Customer"] } },
    });
    expect(count).toBe(2);
  });

  it("never overwrites a type the business has already changed", async () => {
    await seedStarterRecordTypes(organisationId);
    const product = await prisma.customEntityType.findFirstOrThrow({
      where: { organisationId, name: "Product" },
    });
    await prisma.customEntityType.update({
      where: { id: product.id },
      data: {
        fields: [
          {
            name: "sku",
            description: "Renamed by the business",
            type: "text",
            required: true,
          },
        ],
      },
    });

    await seedStarterRecordTypes(organisationId);

    const after = await prisma.customEntityType.findFirstOrThrow({
      where: { id: product.id },
    });
    // Provisioning is deliberately re-runnable, so a business that edited
    // its Product type must not have that quietly reverted the next time
    // the template is provisioned.
    expect((after.fields as { description: string }[])[0]!.description).toBe(
      "Renamed by the business",
    );
  });
});
