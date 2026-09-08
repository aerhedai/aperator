"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { installAgentTemplateAction } from "@/app/(shell)/(app)/agents/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TemplateSummary } from "@/lib/agents/template-service";

function InstallButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Installing…" : "Install"}
    </Button>
  );
}

/**
 * The standalone template library (/templates) and the in-form picker
 * (template-picker.tsx) share this grid treatment, but not this component
 * directly — the in-form picker installs a template into the current
 * form's client state (onInstall), while this page can only hand a
 * template off to a *new* page (agent creation), via a URL, since there's
 * no in-progress form here to install into.
 */
export function TemplateLibrary({
  templates,
}: {
  templates: TemplateSummary[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q),
    );
  }, [templates, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search templates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query ? "No templates match your search." : "No templates yet."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => (
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
                <div className="flex items-center gap-2">
                  <form
                    action={installAgentTemplateAction.bind(null, template.id)}
                  >
                    <InstallButton />
                  </form>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link
                        href={`/agents/new?template=${encodeURIComponent(template.id)}`}
                      />
                    }
                  >
                    Customize first
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
