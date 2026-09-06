import { z } from "zod";

import { TOOL_NAMES } from "@/lib/mcp/tool-registry";

/**
 * The step vocabulary an agent is built from (docs/agent-step-engine-design.md).
 *
 * This replaces "pick one of five Category types" with "compose your own
 * sequence" — the narrowing that makes an agent reliable comes from its own
 * step list, not from a menu the platform imposes (CLAUDE.md §3).
 *
 * Only `extract` and `compose` ever call the model. `lookup`, `compute`,
 * `branch` and `act` are deterministic and cost zero tokens, which is the
 * whole point: sequencing is code, so tool schemas never enter a prompt.
 *
 * Deliberately NOT a general workflow engine — a flat sequence with one
 * level of branching, no loops, no goto, no recursion. A step list always
 * terminates (CLAUDE.md §30: no drag-and-drop workflow editor, and nothing
 * that grows into one by accident).
 */

// An operand is a plain string. `{name}` or `{name.field}` resolves against
// values produced by earlier steps; anything else is a literal. Same
// convention entity-status-signal-pipeline.ts already uses for its folder
// paths and message templates, generalised rather than reinvented.
const operandSchema = z.string();

// Named output of a step, referenced later as {thatName}. Constrained to
// identifier-ish characters so a name can never collide with the
// interpolation syntax itself.
const valueNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    "Must start with a letter and contain only letters, numbers, and underscores",
  );

export const conditionSchema = z.object({
  left: operandSchema,
  operator: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "exists",
    "not_exists",
  ]),
  // Not required for exists/not_exists, which are unary.
  right: operandSchema.optional(),
});

export type Condition = z.infer<typeof conditionSchema>;

// Fixed operation set, never a general expression parser and never eval
// (CLAUDE.md §18 — no arbitrary code execution through configuration).
// Each operation names exactly what it does, so a bad config produces a
// specific error rather than a mystery.
export const computeOperationSchema = z.enum([
  // Arithmetic
  "add",
  "subtract",
  "multiply",
  "divide",
  "round",
  // Text
  "template",
  // Dates
  "date_add_days",
  "date_diff_days",
  "date_format",
  // Aggregates over a list produced by a lookup
  "sum",
  "count",
  "avg",
]);

export type ComputeOperation = z.infer<typeof computeOperationSchema>;

const extractStepSchema = z.object({
  kind: z.literal("extract"),
  fields: z
    .array(
      z.object({
        name: valueNameSchema,
        description: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(20),
});

const lookupStepSchema = z.object({
  kind: z.literal("lookup"),
  as: valueNameSchema,
  recordType: z.string().trim().min(1),
  // Exact match on a field, or a fuzzy text search. Mirrors the
  // find_record / search_records split exactly — an exact match is what a
  // deterministic step can trust, a search is for an LLM's free-text guess.
  match: z.discriminatedUnion("by", [
    z.object({
      by: z.literal("field"),
      field: z.string().trim().min(1),
      value: operandSchema,
    }),
    z.object({
      by: z.literal("search"),
      query: operandSchema,
      // A search naturally returns candidates, not one answer — {as} binds
      // to the whole array by default, for an aggregate compute step to
      // run over (asList() in values.ts). Set true when the step instead
      // wants THE record a fuzzy match found — a quote calculating off
      // {item.data.unitPrice} needs a single object, not a list, and
      // resolvePath() deliberately refuses to index into an array (a path
      // hitting one always resolves to undefined, by design — see its own
      // comment). Binds to the top result, or null if none, the same
      // shape a by:"field" lookup already produces.
      first: z.boolean().default(false),
    }),
  ]),
  // Per-step, because "must exist" and "nice to have" are genuinely
  // different: a quote needs its product, a reply only optionally knows
  // the customer's name. Defaults to optional so a miss degrades rather
  // than failing the run — the caller opts in to strictness.
  required: z.boolean().default(false),
});

const computeStepSchema = z.object({
  kind: z.literal("compute"),
  as: valueNameSchema,
  operation: computeOperationSchema,
  // Interpretation is per-operation; validated at runtime by compute.ts,
  // which reports exactly which operand was wrong for which operation.
  operands: z.array(operandSchema).min(1).max(5),
});

// Retrieval from the business's own knowledge base. Its own kind rather
// than an `act` step calling search_knowledge, because `act` is terminal —
// it ends the run — so retrieved passages could never be used by a later
// compose step, which is the entire point of retrieving them.
const retrieveStepSchema = z.object({
  kind: z.literal("retrieve"),
  as: valueNameSchema,
  query: operandSchema,
  // Small by default: retrieval exists to keep prompts lean, and pulling
  // in ten passages to "be safe" defeats that.
  limit: z.number().int().min(1).max(10).default(4),
});

const composeStepSchema = z.object({
  kind: z.literal("compose"),
  as: valueNameSchema,
  instructions: z.string().trim().min(1).max(2000),
  // Which named values to hand the model as established facts. Explicit
  // rather than "everything so far" so a compose prompt stays narrow —
  // that's where the token saving actually comes from.
  facts: z.array(valueNameSchema).max(20).default([]),
});

/**
 * A tool argument is an operand string, or a nested object/array of them.
 *
 * Nesting is required, not a nicety: `create_record` takes a `data` object
 * of business-defined fields and `save_file` takes a `path` array, so a
 * flat string-only shape could not express either. Every leaf is still an
 * operand, so `{placeholder}` resolution works at any depth.
 */
export type ArgValue = string | ArgValue[] | { [key: string]: ArgValue };

const argValueSchema: z.ZodType<ArgValue> = z.lazy(() =>
  z.union([
    operandSchema,
    z.array(argValueSchema),
    z.record(z.string(), argValueSchema),
  ]),
);

const actStepSchema = z.object({
  kind: z.literal("act"),
  tool: z.enum(TOOL_NAMES),
  args: z.record(z.string(), argValueSchema),
});

// Branch is defined last and separately because it nests: its arms hold
// steps, so the union has to exist before the branch can reference it.
// One level only — a branch arm may not contain another branch.
const leafStepSchema = z.discriminatedUnion("kind", [
  extractStepSchema,
  lookupStepSchema,
  computeStepSchema,
  retrieveStepSchema,
  composeStepSchema,
  actStepSchema,
]);

export type LeafStep = z.infer<typeof leafStepSchema>;

const branchStepSchema = z.object({
  kind: z.literal("branch"),
  when: conditionSchema,
  then: z.array(leafStepSchema).max(20),
  otherwise: z.array(leafStepSchema).max(20).default([]),
});

export const stepSchema = z.union([leafStepSchema, branchStepSchema]);

export type Step = z.infer<typeof stepSchema>;

/**
 * An agent's whole step programme, stored in Agent.pipelineConfig — the
 * existing JSON bag with per-shape Zod validation, extended rather than
 * replaced by a new column (schema.prisma's own reasoning on that field).
 */
export const stepProgrammeSchema = z.object({
  steps: z.array(stepSchema).min(1).max(40),
});

export type StepProgramme = z.infer<typeof stepProgrammeSchema>;
