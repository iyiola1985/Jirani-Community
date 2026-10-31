import { handleTransactionStatusResult } from "@/server/daraja-status-handler";

export async function POST(request: Request) {
  return handleTransactionStatusResult(request, {
    DARAJA_SANDBOX_INITIATOR: process.env.DARAJA_SANDBOX_INITIATOR,
    DARAJA_SANDBOX_SECURITY_CREDENTIAL: process.env.DARAJA_SANDBOX_SECURITY_CREDENTIAL,
    DARAJA_SANDBOX_RESULT_URL: process.env.DARAJA_SANDBOX_RESULT_URL,
    DARAJA_SANDBOX_TIMEOUT_URL: process.env.DARAJA_SANDBOX_TIMEOUT_URL,
    DARAJA_SANDBOX_SHORTCODE: process.env.DARAJA_SANDBOX_SHORTCODE,
  });
}
