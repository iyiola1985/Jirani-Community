import "server-only";

import { createHash } from "node:crypto";

import {
  assertEvidenceDescription,
  assertEvidenceGap,
  evidenceCategory,
  inspectEvidenceFile,
  MAX_EVIDENCE_FILES,
  MAX_EVIDENCE_SUBMISSION_BYTES,
  safeEvidenceLabel,
  type EvidenceCategory,
  type EvidenceContentType,
} from "@/domain/evidence";
import { DomainError } from "@/domain/errors";

export type PreparedEvidence = {
  fileName: string;
  contentType: EvidenceContentType;
  bytes: Uint8Array;
  sha256: string;
  category: EvidenceCategory;
  description: string;
};

export async function evidenceFromForm(formData: FormData): Promise<PreparedEvidence[] | { error: string }> {
  const files = formData.getAll("evidence").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length > MAX_EVIDENCE_FILES) {
    return { error: `Attach up to ${MAX_EVIDENCE_FILES} files.` };
  }
  const categories = formData.getAll("evidenceCategory").map((item) => String(item));
  const descriptions = formData.getAll("evidenceDescription").map((item) => String(item));
  let total = 0;
  const prepared: PreparedEvidence[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;
    total += file.size;
    if (total > MAX_EVIDENCE_SUBMISSION_BYTES) {
      return {
        error: "These files together are too large for one submission. Upload the largest file on its own, then add the others.",
      };
    }
    const label = safeEvidenceLabel(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectEvidenceFile({ claimedType: file.type, bytes });
    if (!inspected.ok) return { error: `${label}: ${inspected.error}` };
    const rawCategory = categories[index]?.trim() ?? "";
    const category = rawCategory ? evidenceCategory(rawCategory) : "other_supporting";
    if (!category) return { error: `${label}: Choose a document category.` };
    let description = "";
    try {
      description = assertEvidenceDescription(descriptions[index] ?? "");
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      return { error: "The note on that file could not be read." };
    }
    prepared.push({
      fileName: label,
      contentType: inspected.contentType,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      category,
      description,
    });
  }
  return prepared;
}

export function gapFromForm(formData: FormData): string | { error: string } {
  try {
    return assertEvidenceGap(String(formData.get("evidenceGap") ?? ""));
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "The note about the missing document could not be read." };
  }
}
