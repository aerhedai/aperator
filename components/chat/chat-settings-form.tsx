"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  updateChatSettingsAction,
  type ChatSettingsState,
} from "@/app/(shell)/chat/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TOOL_GROUPS, TOOL_REGISTRY } from "@/lib/mcp/tool-registry";

interface ChatAgentBasics {
  name: string;
  description: string;
  instructions: string;
  model: string;
}

interface InvokableCandidate {
  id: string;
  name: string;
  description: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

const INITIAL_STATE: ChatSettingsState = {};

export function ChatSettingsForm({
  agent,
  toolNames,
  invokableAgentIds,
  candidates,
}: {
  agent: ChatAgentBasics;
  toolNames: string[];
  invokableAgentIds: string[];
  candidates: InvokableCandidate[];
}) {
  const [state, formAction] = useActionState<ChatSettingsState, FormData>(
    updateChatSettingsAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={agent.name} required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          defaultValue={agent.description}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="instructions">Instructions</Label>
        <Textarea
          id="instructions"
          name="instructions"
          defaultValue={agent.instructions}
          className="min-h-32"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="model">Model</Label>
        <Input
          id="model"
          name="model"
          defaultValue={agent.model}
          placeholder="e.g. qwen2.5:14b"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Tools</Label>
        <div className="flex flex-col gap-4 rounded-md border border-border p-3">
          {TOOL_GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group}
              </span>
              {TOOL_REGISTRY.filter((tool) => tool.group === group).map(
                (tool) => (
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
                      defaultChecked={toolNames.includes(tool.name)}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{tool.label}</span>
                      <span className="text-muted-foreground">
                        {tool.description}
                      </span>
                    </span>
                  </label>
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Agents this can invoke</Label>
        <p className="text-xs text-muted-foreground">
          Every agent in this organisation is available to the assistant by
          default (as long as the &ldquo;Invoke agent&rdquo; tool above is also
          ticked) — untick any you&rsquo;d rather keep off-limits.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No other agents exist yet — anything you create next will be
            available to the assistant automatically.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            {candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex items-start gap-2 text-sm"
                htmlFor={`invoke-${candidate.id}`}
              >
                <input
                  type="checkbox"
                  id={`invoke-${candidate.id}`}
                  name="invokableAgentIds"
                  value={candidate.id}
                  defaultChecked={invokableAgentIds.includes(candidate.id)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{candidate.name}</span>
                  <span className="text-muted-foreground">
                    {candidate.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
