"use client";

import { useFormStatus } from "react-dom";

import { installWorkflowTemplateAction } from "@/app/(shell)/(app)/workflows/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkflowTemplateSummary } from "@/lib/workflows/workflow-template-types";

function InstallButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Installing…" : "Install department"}
    </Button>
  );
}

/**
 * Departments: a classifier plus its handler agents, installed together as
 * one real, ACTIVE workflow — unlike a lone agent template (TemplateLibrary,
 * which installs as a draft nothing points at yet), there's no "customize
 * first" link here, since installing is already the working result, not a
 * starting point to review before it does anything.
 */
export function WorkflowTemplateLibrary({
  templates,
}: {
  templates: WorkflowTemplateSummary[];
}) {
  if (templates.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((template) => (
        <Card key={template.id} className="flex flex-col">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">
                {template.name}
              </CardTitle>
              <Badge variant={template.builtIn ? "secondary" : "outline"}>
                {template.builtIn ? "Built-in" : "Your own"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="flex-1 text-sm text-muted-foreground">
              {template.description}
            </p>
            <p className="text-xs text-muted-foreground">
              {template.handlers.length === 1
                ? `1 handler: ${template.handlers[0]!.name}`
                : `${template.handlers.length} handlers: ${template.handlers
                    .map((h) => h.name)
                    .join(", ")}`}
            </p>
            <form
              action={installWorkflowTemplateAction.bind(null, template.id)}
            >
              <InstallButton />
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
