import "server-only";

import { isDemoMode } from "@/config/brand";
import { getMockProviderSecret } from "@/config/secrets";
import { demoSeed } from "@/data/demo";
import { AssistanceBook } from "@/domain/book";
import { DomainError } from "@/domain/errors";

const globalForBook = globalThis as unknown as { __jiraniBook?: AssistanceBook };

export function getDemoBook(): AssistanceBook {
  if (!isDemoMode()) {
    throw new DomainError("demo_disabled", "Demonstration data is turned off.");
  }
  if (!globalForBook.__jiraniBook) {
    globalForBook.__jiraniBook = AssistanceBook.fromSeed(demoSeed(), getMockProviderSecret());
  }
  return globalForBook.__jiraniBook;
}
