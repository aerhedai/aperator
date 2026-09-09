"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  DEFAULT_STEPS_JSON,
  StepProgrammeFields,
} from "@/components/agents/step-programme-fields";
import {
  TemplatePicker,
  type TemplateOption,
} from "@/components/agents/template-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AgentFormState } from "@/app/(shell)/(app)/agents/actions";
import type { Agent } from "@/lib/generated/prisma/client";
import {
  buildMcpToolName,
  type DiscoveredMcpTool,
} from "@/lib/integrations/mcp/tool-naming";
import { getAvailableTools } from "@/lib/mcp/scope-tool-map";
import {
  getToolProvider,
  TOOL_GROUPS,
  TOOL_REGISTRY,
} from "@/lib/mcp/tool-registry";

/**
 * Creating an agent.
 *
 * Every field here is generic — a name, what it should do, which tools it
 * may use, what it must never say. Nothing on this form is specific to
 * quoting, or complaints, or invoices. The one place anything
 * business-specific appears is the template picker, which pre-fills the
 * steps and ticks the tools those steps need (CLAUDE.md §3: a vertical is
 * a template, never a primitive).
 *
 * This replaced a "Category type" radio list of five fixed process shapes,
 * one of which ("Lookup & Quote") was a hardcoded business process every
 * unrelated business had to scroll past, and each of which revealed a
 * different subset of fields. An agent is now a step programme, full stop.
 *
 * Agents created before that change still run their original pipeline —
 * see the notice rendered for them below. They aren't migrated, and
 * nothing here can turn one into another; they simply keep working.
 *
 * Laid out as sections rather than one long scroll — a business owner
 * configuring an agent isn't reading top to bottom like a document, they're
 * jumping to "what should it say" or "what can it touch." The step editor
 * itself is deliberately unchanged by this: it's a structured JSON editor,
 * not a visual builder (CLAUDE.md §18 rules out a drag-and-drop workflow
 * editor, and branching/nested steps don't reduce to a row-per-step view
 * anyway) — sectioning only reorganizes what surrounds it.
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

type AgentFormValues = Pick<
  Agent,
  | "name"
  | "description"
  | "instructions"
  | "model"
  | "keywords"
  | "executionMode"
  | "pipelineKey"
  | "guardrailKeywords"
  | "actionIntegrationId"
> & {
  toolNames?: string[];
};

// Anything that isn't the generic step pipeline is one of the original
// fixed shapes: a HARNESS pipeline with a code-defined pipelineKey, or a
// LOOP agent — every workflow's classifier, and the only genuinely
// free-form execution mode. Editing one is still allowed — it just can't
// be re-pointed at a different fixed shape from here, because those are no
// longer offered.
//
// LOOP was excluded from this check until this comment, which was a real
// production bug: a LOOP agent has `pipelineKey: null`, so it fell through
// every branch below and was treated as a plain steps agent with no steps
// configured. Saving one — the classifier included — would have silently
// flipped it from LOOP/null to HARNESS/"steps" with an empty programme,
// breaking the manual "Run agent" button (LOOP and HARNESS run through
// different code paths, see lib/runtime/run-agent-by-mode.ts) while leaving
// routing looking unaffected, since dispatch.ts's classifyIntent only ever
// reads instructions/model and never checks executionMode.
//
// CHAT is excluded for the identical reason LOOP is: pipelineKey is also
// null for a CHAT agent, and this form's schema (agentInputSchema) has no
// "chat" categoryType at all — saving one here would silently rewrite it to
// HARNESS/"steps" too. CHAT-mode agents are edited from
// /settings/assistant instead, which is the only UI that creates one.
function isLegacyPipeline(agent?: AgentFormValues): boolean {
  if (!agent) return false;
  if (agent.executionMode === "LOOP" || agent.executionMode === "CHAT") {
    return true;
  }
  return agent.pipelineKey !== null && agent.pipelineKey !== "steps";
}

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "instructions", label: "Instructions & Guardrails" },
  { id: "steps", label: "Steps" },
  { id: "tools", label: "Tools & Permissions" },
  { id: "routing", label: "Routing & Account" },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

// Which section a given field's server-side validation error belongs to —
// used to jump the form to the right place after a failed submit, so an
// error in a section that isn't currently open doesn't silently sit
// off-screen.
const FIELD_SECTION: Record<string, Section> = {
  name: "basics",
  description: "basics",
  instructions: "instructions",
  pipelineConfig: "steps",
  toolNames: "tools",
  model: "routing",
};

// Which provider-specific tools this organisation's connected accounts can
// actually use, given what scope each account was granted at OAuth time —
// the same lib/mcp/scope-tool-map.ts a tool's own handler checks reactively
// and proactively (lib/mcp/tools/shared/ensure-scope-available.ts) at
// runtime. Ticking a tool here that isn't in this set would grant it
// something that's refused the moment it's actually called.
//
// Computed per-provider across *all* of that provider's connected accounts,
// not just whichever one is currently picked as "Action account" — that
// selector only ever offers Gmail accounts today (a pre-existing gap, not
// this feature's problem to fix) and no other provider-specific tool has a
// per-agent account binding at all (see agent-service.ts's
// ACTION_ACCOUNT_PROVIDERS), so every one of them always resolves against
// the organisation's connected account(s) regardless of anything chosen in
// this form. A tool is offered if *any* connected account for its provider
// grants the scope it needs — consistent with how ensureScopeAvailable
// falls back to the organisation's default account when nothing is pinned.
function computeAvailableTools(
  connectedIntegrations: { provider: string; grantedScopes: string[] }[],
): Set<string> {
  const available = new Set<string>();
  for (const integration of connectedIntegrations) {
    for (const tool of getAvailableTools(
      integration.provider,
      integration.grantedScopes,
    )) {
      available.add(tool);
    }
  }
  return available;
}

function sectionForFirstError(
  fieldErrors: AgentFormState["fieldErrors"],
): Section | null {
  if (!fieldErrors) return null;
  for (const key of Object.keys(fieldErrors)) {
    const section = FIELD_SECTION[key];
    if (section) return section;
  }
  return null;
}

export function AgentForm({
  action,
  agent,
  submitLabel,
  templates = [],
  gmailIntegrations = [],
  connectedIntegrations = [],
  mcpConnections = [],
  initialStepsConfig,
  preselectedTemplate,
}: {
  action: (
    prevState: AgentFormState,
    formData: FormData,
  ) => Promise<AgentFormState>;
  agent?: AgentFormValues;
  submitLabel: string;
  // Built-in and this organisation's own saved starting points. Empty by
  // default so any caller not yet passing them still renders.
  templates?: TemplateOption[];
  gmailIntegrations?: { id: string; name: string }[];
  // Every connected account across every provider (not just Gmail), with
  // the scopes it actually granted — used only to decide which
  // provider-specific tools below are checkable, per computeAvailableTools.
  connectedIntegrations?: { provider: string; grantedScopes: string[] }[];
  // This organisation's connected external MCP servers, with the tools
  // discovered from each one's tools/list call. Empty by default so any
  // caller not yet passing them still renders exactly as before.
  mcpConnections?: {
    id: string;
    label: string;
    tools: DiscoveredMcpTool[];
  }[];
  // The agent's existing step programme when editing. Raw rather than
  // typed: it round-trips through the JSON editor and is validated
  // server-side against the same schema the runtime uses.
  initialStepsConfig?: Record<string, unknown>;
  // Arriving from the standalone /templates page rather than picking one
  // from the list below — installed as this form's starting state, exactly
  // as if "Use this" had already been clicked.
  preselectedTemplate?: TemplateOption;
}) {
  const [state, formAction] = useActionState<AgentFormState, FormData>(
    action,
    {},
  );

  const legacy = isLegacyPipeline(agent);

  // Every field error this form knows to render inline, by the FormData
  // name the schema reports it under.
  const KNOWN_FIELD_ERRORS = [
    "name",
    "description",
    "instructions",
    "model",
    "pipelineConfig",
  ];
  // Any error under a key not listed above. A real bug produced exactly
  // this shape once already: categoryType failed validation, nothing here
  // rendered a categoryType error, and the form just sat there on submit
  // with no visible sign anything was wrong. This is not a fix for that bug
  // — the fix is resolving categoryType correctly before it ever reaches
  // validation — it's insurance against the next unrendered field error
  // being just as silent.
  const unhandledFieldErrors = Object.entries(state.fieldErrors ?? {}).filter(
    ([key]) => !KNOWN_FIELD_ERRORS.includes(key),
  );

  const [stepsJson, setStepsJson] = useState(() =>
    preselectedTemplate
      ? JSON.stringify(preselectedTemplate.steps, null, 2)
      : initialStepsConfig && Object.keys(initialStepsConfig).length > 0
        ? JSON.stringify(initialStepsConfig, null, 2)
        : DEFAULT_STEPS_JSON,
  );
  // Controlled rather than defaultChecked, because installing a template
  // ticks the tools its steps need.
  const [toolNames, setToolNames] = useState<Set<string>>(
    () =>
      new Set(preselectedTemplate?.suggestedTools ?? agent?.toolNames ?? []),
  );

  // null = no manual choice since the last submit, so the section with the
  // first error (if any) wins. Cleared on every submit (see the form's
  // onSubmit below) rather than tracked with an effect reacting to `state`
  // changing — a plain event handler setting state in response to the
  // user's own submit action, not a synchronized side effect.
  const [manualSection, setManualSection] = useState<Section | null>(null);
  const activeSection =
    manualSection ?? sectionForFirstError(state.fieldErrors) ?? "basics";

  function installTemplate(template: TemplateOption) {
    setStepsJson(JSON.stringify(template.steps, null, 2));
    // Added to what's already ticked rather than replacing it — someone
    // who ticked a tool before picking a template meant to keep it.
    setToolNames((current) => {
      const next = new Set(current);
      for (const tool of template.suggestedTools) next.add(tool);
      return next;
    });
  }

  const availableTools = useMemo(
    () => computeAvailableTools(connectedIntegrations),
    [connectedIntegrations],
  );

  function toggleTool(name: string, checked: boolean) {
    setToolNames((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  return (
    <form
      action={formAction}
      onSubmit={() => setManualSection(null)}
      className="flex flex-col gap-4"
    >
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {unhandledFieldErrors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">This couldn&rsquo;t be saved:</p>
          <ul className="list-inside list-disc">
            {unhandledFieldErrors.map(([key, messages]) => (
              <li key={key}>
                {key}: {messages?.[0]}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-6">
        <nav className="flex w-56 shrink-0 flex-col gap-0.5">
          {SECTIONS.map((section) => {
            const hasError =
              section.id === sectionForFirstError(state.fieldErrors);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setManualSection(section.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                  activeSection === section.id
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {section.label}
                {hasError && (
                  <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 rounded-lg border border-border p-6">
          <div
            className={cn(
              "flex flex-col gap-4",
              activeSection !== "basics" && "hidden",
            )}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={agent?.name} />
              {state.fieldErrors?.name && (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.name[0]}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                name="description"
                defaultValue={agent?.description}
                rows={3}
                className="w-full rounded-md border border-border bg-transparent p-3 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                What this agent handles. The classifier routes inbound work by
                comparing messages against this, so be specific about scope.
              </p>
              {state.fieldErrors?.description && (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.description[0]}
                </p>
              )}
            </div>
          </div>

          <div
            className={cn(
              "flex flex-col gap-4",
              activeSection !== "instructions" && "hidden",
            )}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="instructions">Instructions</Label>
              <textarea
                id="instructions"
                name="instructions"
                defaultValue={agent?.instructions}
                rows={5}
                className="w-full rounded-md border border-border bg-transparent p-3 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Business-specific guidance, added on top of each step&rsquo;s
                own instructions rather than replacing them.
              </p>
              {state.fieldErrors?.instructions && (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.instructions[0]}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="guardrailKeywords">Never say</Label>
              <Input
                id="guardrailKeywords"
                name="guardrailKeywords"
                defaultValue={agent?.guardrailKeywords?.join(", ")}
                placeholder="e.g. refund, compensation, discount"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. If composed text contains any of these, the run
                fails outright — it&rsquo;s never proposed for approval. Leave
                blank for no guardrail.
              </p>
            </div>
          </div>

          <div
            className={cn(
              "flex flex-col gap-4",
              activeSection !== "steps" && "hidden",
            )}
          >
            {legacy ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/40 p-3">
                {/* categoryType defaults to "steps" server-side when this field is
                    absent, so it must be sent explicitly here — otherwise saving
                    an edit to a legacy agent would silently re-point it at the
                    step pipeline with no steps configured, breaking a working
                    agent through an unrelated edit. A LOOP agent has
                    pipelineKey: null, which is indistinguishable from "not set"
                    once it's the empty string this input would otherwise submit
                    — "loop" has to be spelled out explicitly rather than reusing
                    pipelineKey, or LOOP agents would hit exactly that bug. */}
                <input
                  type="hidden"
                  name="categoryType"
                  value={
                    agent?.executionMode === "LOOP"
                      ? "loop"
                      : (agent?.pipelineKey ?? "")
                  }
                />
                <p className="text-sm font-medium">
                  {agent?.executionMode === "LOOP" ? (
                    <>This agent runs freely (LOOP mode)</>
                  ) : (
                    <>
                      This agent runs the built-in &ldquo;{agent?.pipelineKey}
                      &rdquo; process
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {agent?.executionMode === "LOOP" ? (
                    <>
                      It decides which of its granted tools to call, turn by
                      turn, rather than following a fixed step sequence — this
                      is how every workflow&rsquo;s classifier runs. It
                      isn&rsquo;t editable as steps here; its name, description,
                      instructions, model, and tool grants above still apply and
                      can be changed freely.
                    </>
                  ) : (
                    <>
                      It was created before agents became step sequences, and
                      keeps working exactly as it did. Its steps aren&rsquo;t
                      editable here — to move it onto steps, create a new agent
                      from a template and retire this one.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <>
                <TemplatePicker
                  templates={templates}
                  onInstall={installTemplate}
                />
                <StepProgrammeFields
                  value={stepsJson}
                  onChange={setStepsJson}
                />
                {state.fieldErrors?.pipelineConfig && (
                  <p className="text-sm text-destructive">
                    {state.fieldErrors.pipelineConfig[0]}
                  </p>
                )}
              </>
            )}
          </div>

          <div
            className={cn(
              "flex flex-col gap-4",
              activeSection !== "tools" && "hidden",
            )}
          >
            <div className="flex flex-col gap-2">
              <Label>Tools</Label>
              <div className="flex flex-col gap-4 rounded-md border border-border p-3">
                {TOOL_GROUPS.map((group) => (
                  <div key={group} className="flex flex-col gap-2">
                    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {group}
                    </span>
                    {TOOL_REGISTRY.filter((tool) => tool.group === group).map(
                      (tool) => {
                        const checked = toolNames.has(tool.name);
                        // A tool this organisation's connected account(s)
                        // can't actually use is left checkable if it's
                        // already granted (so an existing grant that a
                        // since-narrowed reconnect made unusable stays
                        // visible rather than silently vanishing from the
                        // form on next save) but can't be newly ticked.
                        const provider = getToolProvider(tool.name);
                        const unavailable =
                          provider !== undefined &&
                          !availableTools.has(tool.name) &&
                          !checked;
                        return (
                          <label
                            key={tool.name}
                            className="flex items-start gap-2 text-sm"
                            htmlFor={`tool-${tool.name}`}
                          >
                            <input
                              type="checkbox"
                              id={`tool-${tool.name}`}
                              name="toolNames"
                              value={tool.name}
                              checked={checked}
                              disabled={unavailable}
                              onChange={(e) =>
                                toggleTool(tool.name, e.target.checked)
                              }
                              className="mt-0.5 h-4 w-4 rounded border-border disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <span className="flex flex-col">
                              <span
                                className={cn(
                                  "font-medium",
                                  unavailable && "text-muted-foreground",
                                )}
                              >
                                {tool.label}
                              </span>
                              <span className="text-muted-foreground">
                                {tool.description}
                              </span>
                              {unavailable && (
                                <span className="text-xs text-destructive">
                                  Not available — reconnect {tool.group} from
                                  Settings and grant this permission.
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      },
                    )}
                  </div>
                ))}
                {(mcpConnections ?? []).map((connection) => (
                  <div key={connection.id} className="flex flex-col gap-2">
                    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {connection.label}
                    </span>
                    {connection.tools.map((tool) => {
                      const fullName = buildMcpToolName(
                        connection.id,
                        tool.name,
                      );
                      return (
                        <label
                          key={fullName}
                          className="flex items-start gap-2 text-sm"
                          htmlFor={`tool-${fullName}`}
                        >
                          <input
                            type="checkbox"
                            id={`tool-${fullName}`}
                            name="toolNames"
                            value={fullName}
                            checked={toolNames.has(fullName)}
                            onChange={(e) =>
                              toggleTool(fullName, e.target.checked)
                            }
                            className="mt-0.5 h-4 w-4 rounded border-border"
                          />
                          <span className="flex flex-col">
                            <span className="font-medium">{tool.name}</span>
                            <span className="text-muted-foreground">
                              {tool.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                A tool call this agent isn&rsquo;t granted here is refused at
                runtime, even if the model asks for it.
              </p>
              {state.fieldErrors?.toolNames && (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.toolNames[0]}
                </p>
              )}
            </div>
          </div>

          <div
            className={cn(
              "flex flex-col gap-4",
              activeSection !== "routing" && "hidden",
            )}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                name="model"
                defaultValue={agent?.model}
                placeholder="e.g. qwen2.5:14b"
              />
              {state.fieldErrors?.model && (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.model[0]}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="keywords">Routing keywords</Label>
              <Input
                id="keywords"
                name="keywords"
                defaultValue={agent?.keywords?.join(", ")}
                placeholder="e.g. quote, price, how much"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. If an inbound message contains one of these
                words and no other agent&rsquo;s keywords also match, routing
                skips the LLM classifier entirely. Leave blank to always ask the
                classifier.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="actionIntegrationId">Action account</Label>
              <select
                id="actionIntegrationId"
                name="actionIntegrationId"
                defaultValue={agent?.actionIntegrationId ?? ""}
                className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">Organisation&rsquo;s default account</option>
                {gmailIntegrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Which connected account this agent sends from. Leave as default
                unless this business has connected more than one and needs
                different agents replying from different addresses.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
