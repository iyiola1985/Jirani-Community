import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import { simulatedGiftMinor } from "@/domain/money";

describe("simulated gift amounts", () => {
  it("stores whole shillings as cents and rejects an amount below KES 100", () => {
    expect(simulatedGiftMinor(100)).toBe(10_000);
    expect(simulatedGiftMinor(500)).toBe(50_000);
    expect(() => simulatedGiftMinor(50)).toThrow(DomainError);
    expect(() => simulatedGiftMinor(100.5)).toThrow(DomainError);
    expect(() => simulatedGiftMinor(2_000_001)).toThrow(DomainError);
  });
});
