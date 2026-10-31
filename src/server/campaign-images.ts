import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { evidenceBytesMatch, type EvidenceContentType } from "@/domain/evidence";
import { DomainError } from "@/domain/errors";

const ROOT = path.join(process.cwd(), "public", "campaign-images");
const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export async function storeCampaignImage(file: File): Promise<string | null> {
  if (file.size === 0) return null;
  if (file.size > 2_000_000) {
    throw new DomainError("validation", "The campaign image must be 2 MB or smaller.");
  }
  const contentType = TYPES.find((item) => item === file.type);
  if (!contentType) {
    throw new DomainError("validation", "Use a JPEG, PNG, or WebP image.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!evidenceBytesMatch(contentType as EvidenceContentType, bytes)) {
    throw new DomainError("validation", "That file does not match an allowed image type.");
  }
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  const name = `${randomUUID()}.${extension}`;
  await mkdir(ROOT, { recursive: true });
  const destination = path.resolve(ROOT, name);
  if (!destination.startsWith(`${ROOT}${path.sep}`)) {
    throw new DomainError("validation", "The campaign image could not be stored.");
  }
  await writeFile(destination, bytes);
  return `/campaign-images/${name}`;
}
