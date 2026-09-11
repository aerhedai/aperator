import { ChatSettingsForm } from "@/components/chat/chat-settings-form";
import * as agentService from "@/lib/agents/agent-service";
import * as chatAgentService from "@/lib/agents/chat-agent-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function AssistantSettingsPage() {
  const organisation = await getCurrentOrganisation();
  const agent = await chatAgentService.getOrCreateChatAgent(organisation.id);

  const [toolNames, allAgents] = await Promise.all([
    chatAgentService.listChatAgentToolNames(agent.id),
    agentService.listAgents(organisation.id),
  ]);

  // Can't invoke itself, and there's nothing else to invoke it wouldn't
  // already see here — every other agent in the org is a candidate,
  // checked by default (Agent.chatInvokable defaults to true).
  const invokableCandidates = allAgents.filter((a) => a.id !== agent.id);
  const invokableAgentIds = invokableCandidates
    .filter((a) => a.chatInvokable)
    .map((a) => a.id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">Assistant</h2>
        <p className="text-sm text-muted-foreground">
          What your assistant is called, what it should do, and which of your
          workers and tools it may use.
        </p>
      </div>

      <ChatSettingsForm
        agent={{
          name: agent.name,
          description: agent.description,
          instructions: agent.instructions,
          model: agent.model,
        }}
        toolNames={toolNames}
        invokableAgentIds={invokableAgentIds}
        candidates={invokableCandidates.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
        }))}
      />
    </div>
  );
}
