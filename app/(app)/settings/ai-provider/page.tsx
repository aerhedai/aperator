import { AIProviderForm } from "@/components/settings/ai-provider-form";
import { getAIProviderStatus } from "@/lib/ai/organisation-ai-provider";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function AIProviderSettingsPage() {
  const organisation = await getCurrentOrganisation();
  const status = await getAIProviderStatus(
    organisation.id,
    organisation.activeAiProvider,
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">AI Provider</h2>
        <p className="text-sm text-muted-foreground">
          Every agent run in this organisation calls whichever provider is
          active below — nothing runs until one is connected and active. This is
          scoped to your organisation only: no other business on this platform
          can reach it. All three can stay connected at once; switching which is
          active doesn&rsquo;t discard the others&rsquo; credentials.
        </p>
      </div>

      <AIProviderForm status={status} />
    </div>
  );
}
