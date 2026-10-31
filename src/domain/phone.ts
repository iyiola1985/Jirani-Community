export type PhoneVerificationResult = {
  sent: false;
  phone: string | null;
  reason: string;
};

/** Accepts 07…, 2547…, and +2547… and returns E.164. No SMS is sent here. */
export function normalizeKenyanPhone(input: string): string | null {
  const compact = input.replace(/[\s()-]/g, "");
  if (/^\+2547\d{8}$/.test(compact)) return compact;
  if (/^2547\d{8}$/.test(compact)) return `+${compact}`;
  if (/^07\d{8}$/.test(compact)) return `+254${compact.slice(1)}`;
  return null;
}

export function planPhoneVerification(input: string): PhoneVerificationResult {
  const phone = normalizeKenyanPhone(input);
  if (!phone) {
    return { sent: false, phone: null, reason: "Enter a Kenyan mobile number, such as 0712 345 678." };
  }
  return {
    sent: false,
    phone,
    reason: "No SMS provider is connected. The number can be stored later, and no message was sent.",
  };
}
