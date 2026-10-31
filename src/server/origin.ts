import "server-only";

import { headers } from "next/headers";

import { publicSiteUrlProblem } from "@/config/production-env";

export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (process.env.NODE_ENV === "production") {
    const problem = publicSiteUrlProblem(configured);
    if (problem) throw new Error(problem);
    return new URL(configured ?? "").origin;
  }
  if (configured) return configured.replace(/\/$/, "");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}
