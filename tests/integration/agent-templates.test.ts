import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUILT_IN_TEMPLATES } from "@/lib/agents/built-in-templates";
import * as templateService from "@/lib/agents/template-service";
import { prisma } from "@/lib/db/prisma";
import { stepProgrammeSchema } from "@/lib/harness/steps/schema";
import { TOOL_NAMES } from "@/lib/mcp/tool-registry";

// Templates are where verticals live now — "Look up and quote" is a row
// here rather than a category every unrelated business scrolls past. These
// cover the two properties that make that safe: a template must actually
// run, and one business must never be able to break another's.
describe("agent templates", () => {
  const organisationId = "test-org-templates";
  const otherOrganisationId = "test-org-templates-other";

  beforeAll(async () => {
    for (const id of [organisationId, otherOrganisationId]) {
      await prisma.organisation.create({
        data: { id, clerkOrgId: id, name: id, currency: "GBP" },
      });
    }
  });

  afterAll(async () => {
    const ids = [organisationId, otherOrganisationId];
    await prisma.agentTemplate.deleteMany({
      where: { organisationId: { in: ids } },
    });
    await prisma.organisation.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // "loop" templates (e.g. Inbox Manager) don't have a step programme at
  // all — their `steps` field is an unused placeholder (installAgentSpec
  // never validates or runs it for that categoryType; the runtime is a
  // free-form tool-calling loop, not a fixed sequence) — so neither check
  // below applies to them.
  const stepProgrammeTemplates = BUILT_IN_TEMPLATES.filter(
    (t) => (t.categoryType ?? "steps") === "steps",
  );

  it("every built-in template is a programme the runtime would actually accept", () => {
    // A template that can't run isn't a starting point, it's a trap —
    // someone installs it, presses save, and finds out later.
    for (const template of stepProgrammeTemplates) {
      const result = stepProgrammeSchema.safeParse(template.steps);
      expect(
        result.success,
        `${template.name}: ${result.success ? "" : result.error.issues.map((i) => i.message).join("; ")}`,
      ).toBe(true);
    }
  });

  it("every tool a built-in template suggests is one its steps actually need", () => {
    // Suggesting a tool the steps never call would grant an agent access to
    // something for no reason — the opposite of what per-agent grants are
    // for. Note a step's tool isn't always named literally in its JSON:
    // `lookup` calls find_record or search_records depending on its match
    // type, and `retrieve` calls search_knowledge — both without the tool
    // name appearing anywhere in the step.
    for (const template of stepProgrammeTemplates) {
      const steps = template.steps.steps;
      const required = new Set<string>();
      for (const step of steps) {
        if (step.kind === "act") required.add(step.tool);
        if (step.kind === "lookup") {
          required.add(
            step.match.by === "search" ? "search_records" : "find_record",
          );
        }
        if (step.kind === "retrieve") required.add("search_knowledge");
      }
      for (const tool of template.suggestedTools) {
        expect(
          required.has(tool),
          `${template.name} suggests "${tool}" but no step needs it`,
        ).toBe(true);
      }
      // And the converse: a step needing a tool nobody ticks would fail at
      // runtime with "does not have access".
      for (const tool of required) {
        expect(
          template.suggestedTools.includes(tool),
          `${template.name} has a step needing "${tool}" but doesn't suggest it`,
        ).toBe(true);
      }
    }
  });

  it("every loop template's suggested tools are real, registered tools", () => {
    // A loop template has no step programme to cross-check suggestedTools
    // against (the model decides tool order itself at runtime) — the
    // equivalent check here is just that nothing suggests a tool that
    // doesn't actually exist, which installAgentSpec's own toolNames
    // validation would otherwise only catch at install time.
    const loopTemplates = BUILT_IN_TEMPLATES.filter(
      (t) => t.categoryType === "loop",
    );
    expect(loopTemplates.length).toBeGreaterThan(0);
    for (const template of loopTemplates) {
      for (const tool of template.suggestedTools) {
        expect(
          (TOOL_NAMES as readonly string[]).includes(tool),
          `${template.name} suggests "${tool}", which isn't a real tool`,
        ).toBe(true);
      }
    }
  });

  it("seeds built-ins on first list, and doesn't duplicate them on later ones", async () => {
    await templateService.listTemplates(organisationId);
    const first = await prisma.agentTemplate.count({
      where: { organisationId: null },
    });
    await templateService.listTemplates(organisationId);
    const second = await prisma.agentTemplate.count({
      where: { organisationId: null },
    });

    expect(first).toBe(BUILT_IN_TEMPLATES.length);
    expect(second).toBe(first);
  });

  it("refreshes a built-in template's content on every list call, even once the count already matches", async () => {
    // Real bug this closes: seeding used to be gated on row *count*
    // ("does every built-in exist"), not content. Production already has
    // all of them, so a fix to a template's actual steps — e.g. the quote
    // template's lookup shape — would never reach it: the count would
    // stay satisfied forever and the stale, buggy row would never update,
    // with no way to force it there directly the way a local reseed can.
    await templateService.listTemplates(organisationId);
    const quoteTemplate = BUILT_IN_TEMPLATES.find((t) => t.key === "quote")!;
    const row = await prisma.agentTemplate.findFirstOrThrow({
      where: { organisationId: null, name: quoteTemplate.name },
    });

    // Simulate a row seeded before a template's definition changed —
    // exactly production's situation for any content fix shipped after
    // launch, not just this test's synthetic corruption.
    await prisma.agentTemplate.update({
      where: { id: row.id },
      data: { steps: { steps: [] } },
    });

    await templateService.listTemplates(organisationId);

    const refreshed = await prisma.agentTemplate.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(refreshed.steps).toEqual(quoteTemplate.steps);
  });

  it("shows a business its own templates alongside the built-ins", async () => {
    await templateService.saveTemplate(organisationId, {
      name: "Our own process",
      description: "Something this business built.",
      steps: {
        steps: [
          {
            kind: "compute",
            as: "note",
            operation: "template",
            operands: ["hello"],
          },
        ],
      },
      suggestedTools: [],
    });

    const templates = await templateService.listTemplates(organisationId);
    expect(templates.some((t) => t.name === "Our own process")).toBe(true);
    expect(templates.some((t) => t.builtIn)).toBe(true);
  });

  it("never shows one business another's saved template", async () => {
    const mine = await templateService.listTemplates(otherOrganisationId);
    expect(mine.some((t) => t.name === "Our own process")).toBe(false);
  });

  it("refuses to save a template whose steps wouldn't run", async () => {
    await expect(
      templateService.saveTemplate(organisationId, {
        name: "Broken",
        description: "Invalid steps.",
        steps: { steps: [{ kind: "not_a_real_step" }] },
        suggestedTools: [],
      }),
    ).rejects.toThrow();
  });

  it("can't delete a built-in template, only its own", async () => {
    const builtIn = await prisma.agentTemplate.findFirstOrThrow({
      where: { organisationId: null },
    });
    const deleted = await templateService.deleteTemplate(
      organisationId,
      builtIn.id,
    );
    // A built-in has a null organisationId, so it can never match a
    // business-scoped delete — that's what stops one business removing a
    // template everyone else depends on.
    expect(deleted).toBe(false);

    const stillThere = await prisma.agentTemplate.count({
      where: { id: builtIn.id },
    });
    expect(stillThere).toBe(1);
  });
});
