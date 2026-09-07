import {
  AddKnowledgeForm,
  DeleteKnowledgeDocument,
} from "@/components/knowledge/knowledge-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listDocuments } from "@/lib/knowledge/knowledge-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const organisation = await getCurrentOrganisation();
  const documents = await listDocuments(organisation.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Knowledge</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          How this business does things — policies, procedures, price lists,
          FAQs. An agent granted the{" "}
          <span className="font-mono">search_knowledge</span> tool retrieves
          only the passages relevant to what it&rsquo;s handling, rather than
          carrying all of this in every prompt.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Add a document
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AddKnowledgeForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Indexed documents
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {documents.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing indexed yet. Until something is here,{" "}
                <span className="font-mono">search_knowledge</span> finds
                nothing — an agent granted it will simply get no passages back.
              </p>
            )}
            {documents.map((document) => (
              <div
                key={document.id}
                className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {document.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {document._count.chunks}{" "}
                    {document._count.chunks === 1 ? "passage" : "passages"} ·{" "}
                    {document.source} ·{" "}
                    {document.createdAt.toLocaleDateString("en-GB")}
                  </p>
                </div>
                <DeleteKnowledgeDocument id={document.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
