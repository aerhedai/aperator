import { z } from "zod";

import {
  composeBaseInstructions,
  withBusinessGuidance,
} from "@/lib/harness/compose-instructions";
import { composeReply } from "@/lib/harness/compose-reply";
import { extractFields } from "@/lib/harness/extract-fields";
import { completePipeline } from "@/lib/harness/pipeline-completion";
import { failPipeline } from "@/lib/harness/pipeline-failure";
import { callTool } from "@/lib/harness/pipeline-helpers";
import { containsForbiddenKeyword } from "@/lib/harness/pipeline-guards";
import { proposeAction } from "@/lib/harness/propose-action";
import {
  EmbeddingUnavailableError,
  search as searchKnowledge,
} from "@/lib/knowledge/knowledge-service";
import { runCompute } from "@/lib/harness/steps/compute";
import { evaluateCondition } from "@/lib/harness/steps/conditions";
import type { ArgValue, LeafStep, Step } from "@/lib/harness/steps/schema";
import {
  interpolate,
  resolveOperand,
  type ValueStore,
} from "@/lib/harness/steps/values";
import type { PipelineContext } from "@/lib/harness/types";
import type { RunResult } from "@/lib/runtime/agent-runtime";

/**
 * Executes an agent's step programme (docs/agent-step-engine-design.md).
 *
 * This is the generic replacement for one-hardcoded-pipeline-file-per-
 * business-process. Control flow stays deterministic code; the model is
 * only ever asked to fill in named fields (`extract`) or write prose
 * (`compose`), never to decide what happens next — the same neuro-symbolic
 * split the existing pipelines proved out, now driven by configuration
 * instead of a TypeScript file per shape.
 *
 * Token behaviour is the point: `lookup`, `compute`, `branch` and `act`
 * make no LLM call at all, and the two that do carry only their own narrow
 * prompt — no tool schemas, no accumulated conversation. See the design
 * doc's §5 for why that matters and what still needs measuring.
 */

// An `act` step ends the run — it's the terminal, policy-gated action.
// Anything after it would run after the run had already been marked
// complete or paused for approval, so the runner stops there.
type StepOutcome = { done: false } | { done: true; result: RunResult };

export async function runStepProgramme(
  context: PipelineContext,
  steps: Step[],
): Promise<RunResult> {
  const store: ValueStore = {
    // The trigger's own facts are addressable from step one, so a config
    // can reference {input} or {senderEmail} without an extract step.
    input: context.input,
    senderEmail: context.senderEmail ?? "",
    organisationName: context.organisation.name,
  };

  const outcome = await runSteps(context, steps, store);
  if (outcome.done) return outcome.result;

  // A programme with no terminal `act` still finished its work (e.g. it
  // only created a record). Completing is correct — failing would be
  // wrong, and leaving the run RUNNING forever would be worse.
  return completePipeline(context, "All steps completed.");
}

async function runSteps(
  context: PipelineContext,
  steps: Step[],
  store: ValueStore,
): Promise<StepOutcome> {
  for (const step of steps) {
    if (step.kind === "branch") {
      const taken = evaluateCondition(step.when, store)
        ? step.then
        : step.otherwise;
      const outcome = await runSteps(context, taken, store);
      if (outcome.done) return outcome;
      continue;
    }

    const outcome = await runLeafStep(context, step, store);
    if (outcome.done) return outcome;
  }
  return { done: false };
}

/**
 * Resolves a tool argument at any depth. Nesting matters because tools
 * legitimately take structured parameters — `create_record`'s `data`
 * object of business-defined fields, `save_file`'s `path` array — so a
 * flat string-only resolver could not call them at all.
 */
function resolveArg(value: ArgValue, store: ValueStore): unknown {
  if (typeof value === "string") return resolveOperand(value, store);
  if (Array.isArray(value)) return value.map((item) => resolveArg(item, store));
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      resolveArg(nested, store),
    ]),
  );
}

async function runLeafStep(
  context: PipelineContext,
  step: LeafStep,
  store: ValueStore,
): Promise<StepOutcome> {
  switch (step.kind) {
    case "extract": {
      // One call for all fields, not one per field — batching is the
      // difference between a single ~200-token prompt and N of them.
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const field of step.fields) {
        shape[field.name] = z.union([z.string(), z.number(), z.null()]);
      }
      const fieldList = step.fields
        .map((f) => `"${f.name}": ${f.description}`)
        .join(", ");

      const extracted = await extractFields(
        context,
        `Extract these fields from the message as JSON: {${fieldList}}. Use null for anything not present in the message. Output ONLY the JSON object, no other text.`,
        z.object(shape),
      );
      if (!extracted) {
        return {
          done: true,
          result: await failPipeline(
            context,
            "Could not extract the required fields from the message.",
          ),
        };
      }
      for (const [name, value] of Object.entries(extracted)) {
        store[name] = value;
      }
      return { done: false };
    }

    case "lookup": {
      // Every access to step.match.query/.value/.field below is gated by
      // an inline `step.match.by === "search"` check, not a boolean alias
      // — TypeScript only narrows the union on the literal discriminant
      // check itself, not on a variable that merely holds its result.
      const resolvedValue = String(
        (step.match.by === "search"
          ? resolveOperand(step.match.query, store)
          : resolveOperand(step.match.value, store)) ?? "",
      ).trim();

      // The key to look up resolved to nothing — most commonly {senderEmail}
      // on a manually triggered run (via the "Run agent" test box, or any
      // future trigger with no real sender), where context.senderEmail is
      // "" rather than a real address. Found live testing the built-in
      // "Look up and quote" template exactly this way: its optional
      // customer lookup sent an empty string to find_record, which
      // rejected it as invalid input — a hard failure for a step marked
      // required: false, on the platform's own flagship template, hit by
      // the most ordinary way of testing it.
      //
      // For an optional lookup this is functionally identical to "not
      // found": there was nothing to search for, so nothing can be found.
      // Short-circuited before ever calling the tool, rather than letting
      // an empty value reach it and rejecting on the tool's own input
      // schema — that produces a raw validation error, not this step's own
      // clear "found nothing" outcome. A required lookup still fails, but
      // with a message naming the actual problem instead of an opaque
      // schema error.
      if (resolvedValue === "") {
        if (!step.required) {
          store[step.as] = step.match.by === "search" ? [] : null;
          return { done: false };
        }
        return {
          done: true,
          result: await failPipeline(
            context,
            `The ${step.recordType} lookup had nothing to look up with — its ${
              step.match.by === "search" ? "query" : `"${step.match.field}"`
            } resolved to an empty value.`,
          ),
        };
      }

      const { toolName, args } =
        step.match.by === "search"
          ? {
              toolName: "search_records",
              args: { recordType: step.recordType, query: resolvedValue },
            }
          : {
              toolName: "find_record",
              args: {
                recordType: step.recordType,
                field: step.match.field,
                value: resolvedValue,
              },
            };

      const result = await callTool(context, toolName, args);

      // A tool-level error (type doesn't exist, tool not granted) is
      // always fatal — distinct from "the lookup ran and found nothing",
      // which is what `required` governs.
      if (result.isError) {
        return {
          done: true,
          result: await failPipeline(
            context,
            `Could not look up ${step.recordType}.`,
          ),
        };
      }

      const isSearch = step.match.by === "search";
      const found = isSearch
        ? ((result.structuredContent?.records as unknown[] | undefined) ?? [])
        : (result.structuredContent?.record ?? null);

      const missing = isSearch
        ? (found as unknown[]).length === 0
        : found === null;

      if (missing && step.required) {
        return {
          done: true,
          result: await failPipeline(
            context,
            `No ${step.recordType} record found, and this step is required.`,
          ),
        };
      }

      // An optional miss stores an empty value and carries on, so a later
      // branch can test it with `exists` — the "configurable per step"
      // behaviour, rather than every optional lookup needing a branch
      // wrapped around it.
      store[step.as] =
        step.match.by === "search" && step.match.first
          ? ((found as unknown[])[0] ?? null)
          : found;
      return { done: false };
    }

    case "compute": {
      const computed = runCompute(step.operation, step.operands, store);
      if (!computed.ok) {
        return {
          done: true,
          result: await failPipeline(context, computed.error),
        };
      }
      store[step.as] = computed.value;
      return { done: false };
    }

    case "retrieve": {
      const query = String(resolveOperand(step.query, store) ?? "").trim();
      if (query === "") {
        return {
          done: true,
          result: await failPipeline(
            context,
            "The retrieve step resolved to an empty search query.",
          ),
        };
      }

      try {
        const passages = await searchKnowledge(context.organisationId, query, {
          limit: step.limit,
        });
        // Stored as prose rather than the raw result objects: this value
        // is destined for a compose step's facts, and document/content
        // pairs read far better there than JSON would.
        store[step.as] = passages
          .map((p) => `From "${p.documentTitle}": ${p.content}`)
          .join("\n\n");
      } catch (error) {
        if (error instanceof EmbeddingUnavailableError) {
          return {
            done: true,
            result: await failPipeline(context, error.message),
          };
        }
        throw error;
      }

      // Finding nothing is not a failure — a business may simply have no
      // document covering this. The programme continues with an empty
      // value, and a branch can test it if the agent needs to care.
      return { done: false };
    }

    case "compose": {
      const facts = step.facts
        .map((name) => `${name}: ${interpolate(`{${name}}`, store)}`)
        .join("\n");

      const text = await composeReply(
        context,
        withBusinessGuidance(
          `${composeBaseInstructions(context.organisation.name)} ${step.instructions}`,
          context.agent,
        ),
        facts,
      );

      // The same guardrail the acknowledge_reply pipeline applies, now
      // available to any composed text: a forbidden phrase means the run
      // fails outright rather than being proposed for approval, so the
      // approval gate isn't relied on to catch an avoidable mistake.
      if (containsForbiddenKeyword(text, context.agent.guardrailKeywords)) {
        return {
          done: true,
          result: await failPipeline(
            context,
            "The composed text contained a phrase this agent is configured never to say.",
          ),
        };
      }

      store[step.as] = text;
      return { done: false };
    }

    case "act": {
      const args: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(step.args)) {
        args[key] = resolveArg(value, store);
      }
      // proposeAction runs the same policy gate as every other tool call:
      // an approval-required tool pauses the run here rather than
      // executing (CLAUDE.md §4.6).
      return {
        done: true,
        result: await proposeAction(context, { toolName: step.tool, args }),
      };
    }
  }
}
