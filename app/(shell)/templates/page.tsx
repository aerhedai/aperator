import { TemplateLibrary } from "@/components/agents/template-library";
import { WorkflowTemplateLibrary } from "@/components/agents/workflow-template-library";
import * as templateService from "@/lib/agents/template-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as workflowTemplateService from "@/lib/workflows/workflow-template-service";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: PageProps<"/templates">) {
  const { error } = await searchParams;
  const organisation = await getCurrentOrganisation();
  const [templates, workflowTemplates] = await Promise.all([
    templateService.listTemplates(organisation.id),
    workflowTemplateService.listWorkflowTemplates(organisation.id),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-xl font-semibold">Templates</h1>

      {typeof error === "string" && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold">Departments</h2>
          <p className="text-sm text-muted-foreground">
            A classifier plus its handler workers, installed together as one
            real, active department — ready to use the moment it&apos;s
            installed. Everything a department fills in stays editable
            afterwards.
          </p>
        </div>
        <WorkflowTemplateLibrary templates={workflowTemplates} />
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold">Worker templates</h2>
          <p className="text-sm text-muted-foreground">
            A saved bundle of steps and suggested tools — a starting point for a
            new worker, not a commitment. Everything a template fills in stays
            editable afterwards.
          </p>
        </div>
        <TemplateLibrary templates={templates} />
      </div>
    </div>
  );
}
