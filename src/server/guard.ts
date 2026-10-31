import "server-only";

import { redirect } from "next/navigation";

import { accessDashboard, type DashboardArea } from "@/domain/auth-access";
import type { Actor } from "@/domain/types";
import { getActor } from "@/server/session";

export async function guardDashboard(area: DashboardArea, nextPath: string): Promise<Actor> {
  const actor = await getActor();
  const decision = accessDashboard(actor, area);
  if (decision === "login") redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (decision === "unauthorized") redirect("/unauthorized");
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return actor;
}
