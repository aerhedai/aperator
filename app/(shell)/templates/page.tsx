import { TemplateLibrary } from "@/components/agents/template-library";
import * as templateService from "@/lib/agents/template-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: PageProps<"/templates">) {
  const { error } = await searchParams;
  const organisation = await getCurrentOrganisation();
  const templates = await templateService.listTemplates(organisation.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-sm text-muted-foreground">
          A saved bundle of steps and suggested tools — a starting point for a
          new agent, not a commitment. Everything a template fills in stays
          editable afterwards.
        </p>
      </div>

      {typeof error === "string" && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <TemplateLibrary templates={templates} />
    </div>
  );
}
