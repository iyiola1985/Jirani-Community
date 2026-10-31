export const ACCOUNT_CLOSE_PHRASE = "delete my account";

export function accountClosePhraseMatches(value: string): boolean {
  return value.trim().toLowerCase() === ACCOUNT_CLOSE_PHRASE;
}

export function replacementPasswordError(current: string, next: string, confirm: string): string | null {
  if (next.length < 10) return "Use at least 10 characters.";
  if (next !== confirm) return "Type the new password the same way twice.";
  if (next === current) return "Choose a password that is different from the current one.";
  return null;
}
