import { DomainError } from "@/domain/errors";

export type FormState = {
  error: string | null;
  notice: string | null;
  fieldErrors: Record<string, string>;
};

export const emptyFormState: FormState = { error: null, notice: null, fieldErrors: {} };

export function toFormError(error: unknown): FormState {
  if (error instanceof DomainError) return { error: error.message, notice: null, fieldErrors: {} };
  console.error(error);
  return { error: "Something went wrong. No payment was marked successful.", notice: null, fieldErrors: {} };
}
