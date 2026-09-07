import {
  DeleteAccountDialog,
  DeleteOrganisationDialog,
  LegalLinksForm,
} from "@/components/settings/legal-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function LegalSettingsPage() {
  const organisation = await getCurrentOrganisation();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h2 className="text-xl font-semibold">Legal</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Terms &amp; privacy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LegalLinksForm
            termsUrl={organisation.termsUrl}
            privacyUrl={organisation.privacyUrl}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Your data
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Download every agent, run, approval, customer, product, and
            integration this organisation owns as one JSON file. Connected
            account credentials are never included.
          </p>
          <Button
            nativeButton={false}
            render={<a href="/api/settings/export" download />}
            className="self-start"
          >
            Export my data
          </Button>
        </CardContent>
      </Card>

      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-destructive">
            Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Delete my account</p>
              <p className="text-sm text-muted-foreground">
                Deletes your personal sign-in. The organisation and its data
                stay intact.
              </p>
            </div>
            <DeleteAccountDialog />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium">Delete this organisation</p>
              <p className="text-sm text-muted-foreground">
                Deletes every agent, run, approval, and connected integration.
                Cannot be undone.
              </p>
            </div>
            <DeleteOrganisationDialog organisationName={organisation.name} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
