import type { Step } from "@/lib/harness/steps/schema";

/**
 * One skeleton per step kind, for the "add a step" buttons in the agent form.
 *
 * Deliberately syntax rather than process: a bare `lookup` with placeholder
 * values, not "look up, price, and reply". Whole worked processes belong in
 * the template picker, which stores them as data a business can edit and save
 * its own versions of (CLAUDE.md §3).
 *
 * Typed as `Step` rather than a loose record so a snippet that drifts out of
 * sync with the step vocabulary fails at compile time, not when someone
 * clicks the button. Lives here rather than in the component so a test can
 * check them against the runtime schema without importing React.
 */

export interface StepSnippet {
  label: string;
  hint: string;
  step: Step;
}

export const STEP_SNIPPETS: StepSnippet[] = [
  {
    label: "extract",
    hint: "Pull named values out of the incoming message. One LLM call.",
    step: {
      kind: "extract",
      fields: [{ name: "value", description: "what to pull out" }],
    },
  },
  {
    label: "lookup",
    hint: "Find one of your records. Free — no LLM call.",
    step: {
      kind: "lookup",
      as: "found",
      recordType: "YourRecordType",
      match: { by: "field", field: "name", value: "{value}" },
      required: true,
    },
  },
  {
    label: "compute",
    hint: "Arithmetic, dates, text templates, aggregates. Free.",
    step: {
      kind: "compute",
      as: "result",
      operation: "multiply",
      operands: ["{found.data.amount}", "1"],
    },
  },
  {
    label: "branch",
    hint: "Take a different path depending on a condition. Free.",
    step: {
      kind: "branch",
      when: { left: "{found}", operator: "exists" },
      then: [],
      otherwise: [],
    },
  },
  {
    label: "retrieve",
    hint: "Search your knowledge base for passages to answer from.",
    step: { kind: "retrieve", as: "passages", query: "{value}", limit: 4 },
  },
  {
    label: "compose",
    hint: "Write text from named facts, and nothing else. One LLM call.",
    step: {
      kind: "compose",
      as: "body",
      instructions: "Write a short, professional reply.",
      facts: ["value", "result"],
    },
  },
  {
    label: "act",
    hint: "Call a granted tool. Always the last step — it ends the run.",
    step: {
      kind: "act",
      tool: "create_record",
      args: {
        recordType: "YourRecordType",
        data: { name: "{value}" },
      },
    },
  },
];
