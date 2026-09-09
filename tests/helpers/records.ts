import { prisma } from "@/lib/db/prisma";
import { seedStarterRecordTypes } from "@/lib/records/starter-record-type-service";

/**
 * Test helpers for creating business data.
 *
 * Product and Customer were real tables with real columns, so tests created
 * them with `prisma.product.create({ data: { sku, unitPrice, ... } })`.
 * Since the catalog collapse they are ordinary Record Types, and a record is
 * a row in one shared table with its fields in JSON. That is more setup per
 * test, so it lives here once rather than being spelled out in each.
 */

/** Seeds the Product and Customer record types for an organisation. */
export async function seedStarterTypes(organisationId: string) {
  await seedStarterRecordTypes(organisationId, ["Product", "Customer"]);
}

/**
 * Creates one record of a named type, seeding the type if it isn't there.
 *
 * Returns the row so a test can assert on its id. Deliberately does not
 * validate against the type's field definitions — a few tests need to store
 * a deliberately odd shape, and the validation those go through in the app
 * is covered directly in the entity tests.
 */
export async function createRecord(
  organisationId: string,
  typeName: string,
  data: Record<string, unknown>,
) {
  let type = await prisma.customEntityType.findFirst({
    where: { organisationId, name: typeName },
  });
  if (!type) {
    // Scoped to just the requested type — seeding every starter type here
    // (Product, Customer, Lead, Booking, ...) would silently give a test
    // record types it never asked for, breaking any test that asserts an
    // organisation's exact record type list.
    await seedStarterRecordTypes(organisationId, [typeName]);
    type = await prisma.customEntityType.findFirst({
      where: { organisationId, name: typeName },
    });
  }
  if (!type) {
    throw new Error(
      `No record type "${typeName}" for ${organisationId}, and it isn't a starter type.`,
    );
  }
  return prisma.customEntityRecord.create({
    data: { organisationId, entityTypeId: type.id, data: data as object },
  });
}

/** Removes all record types and records for an organisation. */
export async function clearRecords(organisationId: string) {
  await prisma.customEntityRecord.deleteMany({ where: { organisationId } });
  await prisma.customEntityType.deleteMany({ where: { organisationId } });
}
