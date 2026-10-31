import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { evidenceExtension, type EvidenceContentType } from "@/domain/evidence";

const ROOT = path.resolve(process.cwd(), "storage/private-evidence");

function storedPath(storageKey: string): string {
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4|webm)$/.test(storageKey)) {
    throw new Error("Unexpected evidence file name.");
  }
  const full = path.resolve(ROOT, storageKey);
  if (!full.startsWith(`${ROOT}${path.sep}`)) throw new Error("Unexpected evidence file name.");
  return full;
}

export async function writePrivateEvidence(contentType: EvidenceContentType, bytes: Uint8Array): Promise<string> {
  const extension = evidenceExtension(contentType);
  if (!extension) throw new Error("Unexpected evidence type.");
  const storageKey = `${randomUUID()}.${extension}`;
  await mkdir(ROOT, { recursive: true });
  await writeFile(storedPath(storageKey), bytes);
  return storageKey;
}

export async function readPrivateEvidence(storageKey: string): Promise<Buffer> {
  return readFile(storedPath(storageKey));
}

export async function removePrivateEvidence(storageKey: string): Promise<void> {
  await rm(storedPath(storageKey), { force: true });
}
