"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as accountService from "@/lib/auth/account-service";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as aiProviderService from "@/lib/ai/organisation-ai-provider";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as organisationService from "@/lib/organisations/organisation-service";
import {
  legalLinksInputSchema,
  organisationInputSchema,
} from "@/lib/organisations/schemas";

export async function disconnectIntegrationAction(integrationId: string) {
  const organisation = await getCurrentOrganisation();
  await integrationService.disconnectIntegration(
    organisation.id,
    integrationId,
  );
  revalidatePath("/settings/integrations");
}

// Bound to a provider the same way disconnectIntegrationAction is bound to
// an integrationId — "Delete" on an integration card removes every
// connected account of that provider in one go.
export async function disconnectAllAccountsAction(provider: string) {
  const organisation = await getCurrentOrganisation();
  await integrationService.disconnectAllAccounts(organisation.id, provider);
  revalidatePath("/settings/integrations");
}

export type WebhookAccountFormState = {
  error?: string;
  // Only ever set once, in the response to the request that created it —
  // never re-fetched or persisted anywhere the client can read it again.
  created?: { integrationId: string; secret: string };
};

export async function createWebhookAccountAction(
  _prevState: WebhookAccountFormState,
  formData: FormData,
): Promise<WebhookAccountFormState> {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim().length === 0) {
    return { error: "Name is required." };
  }

  const organisation = await getCurrentOrganisation();

  // Unlike Gmail, where "same name" (the connected email) genuinely means
  // "the same account, safe to refresh" — a webhook's name is just a
  // free-text label a business typed. Reusing upsertIntegration's
  // same-name-overwrites semantics here unchecked would let a duplicate
  // name silently regenerate another account's secret instead of creating
  // a new one, with no warning.
  const existing = await integrationService.listIntegrationsByProvider(
    organisation.id,
    "webhook",
  );
  if (existing.some((i) => i.name === name.trim())) {
    return {
      error: `An account named "${name.trim()}" already exists — pick a different name.`,
    };
  }

  const { integration, secret } =
    await integrationService.connectWebhookAccount(
      organisation.id,
      name.trim(),
    );
  revalidatePath("/settings/integrations");
  return { created: { integrationId: integration.id, secret } };
}

export type BusinessProfileFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function updateBusinessProfileAction(
  _prevState: BusinessProfileFormState,
  formData: FormData,
): Promise<BusinessProfileFormState> {
  const parsed = organisationInputSchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const organisation = await getCurrentOrganisation();
  await organisationService.updateOrganisation(organisation.id, parsed.data);
  revalidatePath("/settings/business");
  return {};
}

export type LegalLinksFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function updateLegalLinksAction(
  _prevState: LegalLinksFormState,
  formData: FormData,
): Promise<LegalLinksFormState> {
  const parsed = legalLinksInputSchema.safeParse({
    termsUrl: formData.get("termsUrl"),
    privacyUrl: formData.get("privacyUrl"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const organisation = await getCurrentOrganisation();
  await organisationService.updateLegalLinks(organisation.id, parsed.data);
  revalidatePath("/settings/legal");
  return {};
}

export type DangerZoneFormState = { error?: string };

// Confirmation is checked server-side, not just disabled-until-matching in
// the client — a destructive action's real gate can't live only in UI state.
export async function deleteMyAccountAction(
  _prevState: DangerZoneFormState,
  formData: FormData,
): Promise<DangerZoneFormState> {
  const confirmation = formData.get("confirmation");
  if (confirmation !== "DELETE") {
    return { error: 'Type "DELETE" to confirm.' };
  }

  const user = await getCurrentUser();
  await accountService.deleteMyAccount(user.id, user.clerkUserId);
  redirect("/sign-in");
}

export async function deleteOrganisationAction(
  _prevState: DangerZoneFormState,
  formData: FormData,
): Promise<DangerZoneFormState> {
  const organisation = await getCurrentOrganisation();
  const confirmation = formData.get("confirmation");
  if (
    typeof confirmation !== "string" ||
    confirmation.trim() !== organisation.name
  ) {
    return { error: `Type "${organisation.name}" to confirm.` };
  }

  await organisationService.deleteOrganisation(
    organisation.id,
    organisation.clerkOrgId,
  );
  redirect("/select-organisation");
}

export type AIProviderFormState = {
  error?: string;
  saved?: boolean;
};

export async function saveOllamaProviderAction(
  _prevState: AIProviderFormState,
  formData: FormData,
): Promise<AIProviderFormState> {
  const baseUrl = formData.get("baseUrl");
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return { error: "Base URL is required." };
  }
  // Caught here rather than only failing the next time an agent tries to
  // run against an unusable value.
  const isValidUrl = URL.canParse(baseUrl.trim());
  if (!isValidUrl) {
    return { error: "Base URL must be a valid URL, e.g. https://host:11434." };
  }

  const proxySecretRaw = formData.get("proxySecret");
  const proxySecret =
    typeof proxySecretRaw === "string" && proxySecretRaw.trim().length > 0
      ? proxySecretRaw.trim()
      : undefined;

  const organisation = await getCurrentOrganisation();
  await aiProviderService.setOllamaProvider(organisation.id, {
    baseUrl: baseUrl.trim(),
    proxySecret,
  });
  revalidatePath("/settings/ai-provider");
  return { saved: true };
}

export async function saveGeminiProviderAction(
  _prevState: AIProviderFormState,
  formData: FormData,
): Promise<AIProviderFormState> {
  const apiKeyRaw = formData.get("apiKey");
  const apiKey =
    typeof apiKeyRaw === "string" && apiKeyRaw.trim().length > 0
      ? apiKeyRaw.trim()
      : undefined;

  const organisation = await getCurrentOrganisation();
  try {
    await aiProviderService.setGeminiProvider(organisation.id, { apiKey });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Couldn't save this.",
    };
  }
  revalidatePath("/settings/ai-provider");
  return { saved: true };
}

export async function saveOpenRouterProviderAction(
  _prevState: AIProviderFormState,
  formData: FormData,
): Promise<AIProviderFormState> {
  const apiKeyRaw = formData.get("apiKey");
  const apiKey =
    typeof apiKeyRaw === "string" && apiKeyRaw.trim().length > 0
      ? apiKeyRaw.trim()
      : undefined;

  const organisation = await getCurrentOrganisation();
  try {
    await aiProviderService.setOpenRouterProvider(organisation.id, { apiKey });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Couldn't save this.",
    };
  }
  revalidatePath("/settings/ai-provider");
  return { saved: true };
}

export async function disconnectProviderAction(
  provider: aiProviderService.AIProviderKind,
) {
  const organisation = await getCurrentOrganisation();
  await aiProviderService.disconnectProvider(organisation.id, provider);
  revalidatePath("/settings/ai-provider");
}

export async function setActiveProviderAction(
  provider: aiProviderService.AIProviderKind,
) {
  const organisation = await getCurrentOrganisation();
  // Errors here (nothing connected for this provider yet) are deliberately
  // allowed to throw rather than fail silently — this is a plain <form>
  // action with no useActionState wired up, so there's no field to render
  // an error into; Next's own error boundary is the right place for a
  // "you clicked something that isn't valid right now" case this narrow.
  await aiProviderService.setActiveProvider(organisation.id, provider);
  revalidatePath("/settings/ai-provider");
}
