import { BUILT_IN_TEMPLATES } from "@/lib/agents/built-in-templates";
import { prisma } from "@/lib/db/prisma";
import { stepProgrammeSchema } from "@/lib/harness/steps/schema";

/**
 * Agent templates: named, reusable step programmes.
 *
 * Two sources, one list: built-ins (organisationId null, visible to every
 * business) and a business's own saved ones. Callers don't need to care
 * which is which beyond not being able to delete a built-in.
 */

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  steps: unknown;
  suggestedTools: string[];
  builtIn: boolean;
}

export async function listTemplates(
  organisationId: string,
): Promise<TemplateSummary[]> {
  // Seeded on every read rather than by migration or at boot: the
  // definitions live in code (built-in-templates.ts), so a migration would
  // drift from them the moment one changed. seedBuiltInTemplates matches on
  // name and updates in place, so this converges rather than duplicating —
  // that's also why it has to run unconditionally rather than only when a
  // template is missing.
  //
  // A count-based guard used to skip this once every built-in template
  // already existed, which quietly broke the "updates the shipped
  // definition in place" promise the moment a template's *content* changed
  // post-launch rather than one being newly added: production already has
  // all 4 rows, so the count check would never fire again, and a real fix
  // to a template (e.g. the quote template's lookup shape) would never
  // reach it — with no direct way to force a reseed there, unlike local
  // dev. Running this every time an agent is created or edited is cheap —
  // a handful of indexed queries on a page that's already doing several —
  // and it's the only way a template content fix ever reaches a database
  // this code doesn't have direct access to.
  await seedBuiltInTemplates();

  const rows = await prisma.agentTemplate.findMany({
    where: { OR: [{ organisationId: null }, { organisationId }] },
    orderBy: [{ organisationId: "asc" }, { name: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    steps: row.steps,
    suggestedTools: row.suggestedTools,
    builtIn: row.organisationId === null,
  }));
}

// Org-scoped single lookup, same visibility rule as listTemplates (a
// built-in or one of this organisation's own) — used by the real
// one-click install action, which only ever needs one row, not the whole
// list.
export async function getTemplate(
  organisationId: string,
  id: string,
): Promise<TemplateSummary | null> {
  const row = await prisma.agentTemplate.findFirst({
    where: { id, OR: [{ organisationId: null }, { organisationId }] },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: row.steps,
    suggestedTools: row.suggestedTools,
    builtIn: row.organisationId === null,
  };
}

export async function saveTemplate(
  organisationId: string,
  input: {
    name: string;
    description: string;
    steps: unknown;
    suggestedTools: string[];
  },
) {
  // A template that wouldn't run isn't a template — validated against the
  // same schema the runtime uses, so installing one can't produce a
  // broken agent.
  const parsed = stepProgrammeSchema.safeParse(input.steps);
  if (!parsed.success) {
    throw new Error(
      `These steps aren't valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return prisma.agentTemplate.create({
    data: {
      organisationId,
      name: input.name,
      description: input.description,
      steps: parsed.data,
      suggestedTools: input.suggestedTools,
    },
  });
}

export async function deleteTemplate(organisationId: string, id: string) {
  // Scoped to the organisation's own templates: a built-in has a null
  // organisationId and so can never match, which is what stops one
  // business deleting a template everyone else depends on.
  const { count } = await prisma.agentTemplate.deleteMany({
    where: { id, organisationId },
  });
  return count > 0;
}

/**
 * Seeds the built-in templates, idempotently.
 *
 * Matched by name among the null-organisation rows rather than by a fixed
 * id, so re-running updates the shipped definition in place instead of
 * accumulating duplicates every deploy.
 */
export async function seedBuiltInTemplates(): Promise<number> {
  let written = 0;
  for (const template of BUILT_IN_TEMPLATES) {
    const existing = await prisma.agentTemplate.findFirst({
      where: { organisationId: null, name: template.name },
    });
    const data = {
      name: template.name,
      description: template.description,
      steps: template.steps as object,
      suggestedTools: template.suggestedTools,
    };
    if (existing) {
      await prisma.agentTemplate.update({ where: { id: existing.id }, data });
    } else {
      await prisma.agentTemplate.create({
        data: { ...data, organisationId: null },
      });
    }
    written += 1;
  }
  return written;
}
