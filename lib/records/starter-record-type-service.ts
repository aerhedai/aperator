import * as entityTypeRepository from "@/lib/entities/entity-type-repository";
import { entityTypeInputSchema } from "@/lib/entities/schemas";
import { STARTER_RECORD_TYPES } from "@/lib/records/starter-record-types";

/**
 * Seeds starter Record Types (Product, Customer, Lead, Booking, ...) for an
 * organisation.
 *
 * Called when a template that needs them is provisioned/installed — e.g.
 * the "Email Handling" workflow needs Product/Customer because its Quote
 * agent looks records up by type name, and "Lead Intake"
 * (built-in-workflow-templates.ts) needs Lead. This is a template bringing
 * its Record Types with it (CLAUDE.md §6), not the platform deciding every
 * business sells products.
 *
 * `names` restricts which of STARTER_RECORD_TYPES to seed — omitted means
 * every one of them, the original behaviour every existing caller still
 * gets unchanged. A workflow template only ever asks for the specific
 * names its own handlers need, so installing e.g. "Lead Intake" doesn't
 * also hand a business an unrelated Booking type it never asked for.
 *
 * Skips any name the business already has, rather than overwriting: a
 * business that has renamed a field on its Product type, or defined its own
 * type that happens to be called Product, must not have that quietly
 * reverted on the next provisioning run — and provisioning is deliberately
 * re-runnable.
 *
 * Returns the names actually created, so a caller can tell "seeded" from
 * "already there" instead of guessing.
 */
export async function seedStarterRecordTypes(
  organisationId: string,
  names?: string[],
): Promise<string[]> {
  const created: string[] = [];
  const definitions = names
    ? STARTER_RECORD_TYPES.filter((d) => names.includes(d.name))
    : STARTER_RECORD_TYPES;

  for (const definition of definitions) {
    const existing = await entityTypeRepository.findEntityTypeByName(
      organisationId,
      definition.name,
    );
    if (existing) continue;

    // Parsed rather than passed straight through, so a malformed starter
    // definition fails here instead of producing a record type whose own
    // records can never validate against it.
    const parsed = entityTypeInputSchema.parse(definition);
    await entityTypeRepository.createEntityType(organisationId, parsed);
    created.push(parsed.name);
  }

  return created;
}
