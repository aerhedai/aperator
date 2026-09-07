"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import { resumeRun } from "@/lib/runtime/agent-runtime";

async function decide(runId: string, decision: "APPROVED" | "REJECTED") {
  const organisation = await getCurrentOrganisation();
  const approver = await getCurrentUser();
  await resumeRun(runId, organisation.id, decision, approver.id);
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
}

export async function approveRunAction(runId: string) {
  await decide(runId, "APPROVED");
}

export async function rejectRunAction(runId: string) {
  await decide(runId, "REJECTED");
}
