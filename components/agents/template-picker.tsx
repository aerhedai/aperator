"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * Choosing a starting point for a new agent.
 *
 * This is the *only* place anything business-specific appears in agent
 * creation. Every other field on the form is generic — a name, what it
 * should do, which tools it may use — and a template just pre-fills the
 * steps and ticks the tools those steps need (CLAUDE.md §3: a vertical is
 * a template, never a primitive).
 *
 * Installing one is a starting point, not a commitment: everything it
 * fills in stays editable afterwards.
 *
 * Shares its grid treatment with the standalone /templates page
 * (template-library.tsx), but not the component itself — that page hands a
 * template to a *new* page via a URL, since there's no in-progress form to
 * install into; this one installs directly into the current form's state.
 */

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  steps: unknown;
  suggestedTools: string[];
  builtIn: boolean;
}

export function TemplatePicker({
  templates,
  onInstall,
}: {
  templates: TemplateOption[];
  onInstall: (template: TemplateOption) => void;
}) {
  if (templates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <Label>Start from a template</Label>
      <p className="text-xs text-muted-foreground">
        Fills in the steps and ticks the tools they need. Everything stays
        editable afterwards — or skip this and build the steps yourself.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="flex-1 text-xs text-muted-foreground">
                {template.description}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => onInstall(template)}
              >
                Use this
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
