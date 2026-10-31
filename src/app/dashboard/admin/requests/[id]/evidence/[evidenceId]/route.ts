import { openEvidenceDownload } from "@/server/private-evidence";
import { getActor } from "@/server/session";

export async function GET(_request: Request, context: RouteContext<"/dashboard/admin/requests/[id]/evidence/[evidenceId]">) {
  const actor = await getActor();
  const { id, evidenceId } = await context.params;
  const result = await openEvidenceDownload({
    actor,
    audience: "administrator",
    requestId: id,
    campaignId: null,
    evidenceId,
  });
  if (result.status !== 200) return new Response(result.status === 401 ? "Sign in required." : result.status === 403 ? "Not available." : "Not found.", { status: result.status });
  return new Response(Buffer.from(result.body), { headers: result.headers });
}
