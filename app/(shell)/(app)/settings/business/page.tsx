import { BusinessProfileForm } from "@/components/settings/business-profile-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function BusinessSettingsPage() {
  const organisation = await getCurrentOrganisation();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h2 className="text-xl font-semibold">Business</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Business profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BusinessProfileForm
            name={organisation.name}
            currency={organisation.currency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
