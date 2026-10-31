import type { BookSeed } from "@/domain/book";
import { INACTIVE_DEMO_FEE_RULE } from "@/domain/fees";
import type { Contribution } from "@/domain/types";

export const DEMO_RECIPIENT_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_DONOR_ID = "22222222-2222-4222-8222-222222222222";
export const DEMO_ADMIN_ID = "33333333-3333-4333-8333-333333333333";
export const DEMO_OTHER_RECIPIENT_ID = "44444444-4444-4444-8444-444444444444";
export const DEMO_NEIGHBOUR_ID = "55555555-5555-4555-8555-555555555555";

export const DEMO_SCHOOL_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const DEMO_RENT_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const DEMO_GAS_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const DEMO_MEDICAL_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
export const DEMO_DRAFT_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";

export const DEMO_ACTIVE_CAMPAIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const DEMO_CLOSED_CAMPAIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const DEMO_REPORTED_CAMPAIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

/** A fake number used only inside a private demonstration note. */
export const DEMO_PRIVATE_PHONE = "0700 000 000";

const AT = "2026-10-12T09:00:00.000Z";

function gift(input: {
  id: string;
  donorId: string;
  requestId?: string;
  campaignId?: string;
  giftMinor: number;
  recognition: "public" | "anonymous";
  publicName: string | null;
  createdAt: string;
}): Contribution {
  return {
    id: input.id,
    donorId: input.donorId,
    requestId: input.requestId ?? null,
    campaignId: input.campaignId ?? null,
    recognition: input.recognition,
    publicName: input.publicName,
    giftMinor: input.giftMinor,
    collectedPlatformFeeMinor: 0,
    campaignBorneFeeMinor: 0,
    providerFeeMinor: 0,
    donorPaysMinor: input.giftMinor,
    netToCauseMinor: input.giftMinor,
    currency: "KES",
    idempotencyKey: `seed-${input.id}`,
    provider: "mock",
    providerReference: `mock_seed_${input.id}`,
    simulated: true,
    createdAt: input.createdAt,
    status: "successful",
    receiptNumber: `SIM-${input.id.slice(-4)}`,
  };
}

export function demoSeed(): BookSeed {
  return {
    feeRules: [INACTIVE_DEMO_FEE_RULE],
    requests: [
      {
        id: DEMO_SCHOOL_REQUEST_ID,
        ownerId: DEMO_RECIPIENT_ID,
        publicAlias: "Achieng (demonstration)",
        category: "school",
        title: "Secondary school fees in Kisumu County",
        summary:
          "Support toward this term's secondary school fees for a household in Kisumu County. The public name is a chosen alias. No school admission number is published.",
        county: "Kisumu",
        amountNeededMinor: 1_850_000,
        currency: "KES",
        status: "published",
        privateNotes: `Caseworker follow-up only. Demonstration phone ${DEMO_PRIVATE_PHONE}. Not a real household.`,
        demo: true,
        flags: [],
        createdAt: AT,
      },
      {
        id: DEMO_RENT_REQUEST_ID,
        ownerId: DEMO_OTHER_RECIPIENT_ID,
        publicAlias: "Neighbour in Nakuru",
        category: "rent",
        title: "Rent arrears for a household in Nakuru County",
        summary:
          "Help clearing two months of rent for a household in Nakuru County. The exact estate and house number stay in the private review file.",
        county: "Nakuru",
        amountNeededMinor: 2_400_000,
        currency: "KES",
        status: "published",
        privateNotes: "Demonstration landlord reference kept off the public page.",
        demo: true,
        flags: [],
        createdAt: AT,
      },
      {
        id: DEMO_GAS_REQUEST_ID,
        ownerId: DEMO_OTHER_RECIPIENT_ID,
        publicAlias: "Household in Machakos",
        category: "cooking_gas",
        title: "Cooking gas and food in Machakos County",
        summary:
          "A household in Machakos County is asking for help with cooking gas and a basic food shop. The request names the county and the need, not a street address.",
        county: "Machakos",
        amountNeededMinor: 750_000,
        currency: "KES",
        status: "published",
        privateNotes: "Demonstration note for the reviewer.",
        demo: true,
        flags: [],
        createdAt: AT,
      },
      {
        id: DEMO_MEDICAL_REQUEST_ID,
        ownerId: DEMO_OTHER_RECIPIENT_ID,
        publicAlias: "Family in Mombasa",
        category: "medical",
        title: "Hospital bill in Mombasa County",
        summary:
          "Support toward a hospital bill in Mombasa County. The diagnosis, patient file, and any child's details are kept in the private review file and are not published.",
        county: "Mombasa",
        amountNeededMinor: 3_200_000,
        currency: "KES",
        status: "published",
        privateNotes: "Demonstration clinical note. Do not copy this sentence onto a public page.",
        demo: true,
        flags: [],
        createdAt: AT,
      },
      {
        id: DEMO_DRAFT_REQUEST_ID,
        ownerId: DEMO_RECIPIENT_ID,
        publicAlias: "Achieng (demonstration)",
        category: "electricity",
        title: "Electricity reconnection in Kisumu County",
        summary:
          "Help with an electricity reconnection for a household in Kisumu County. This demonstration request is still with the reviewer and is not on the public list.",
        county: "Kisumu",
        amountNeededMinor: 450_000,
        currency: "KES",
        status: "under_review",
        privateNotes: "Waiting for a clearer bill photo. Demonstration only.",
        demo: true,
        flags: [],
        createdAt: AT,
      },
    ],
    campaigns: [
      {
        id: DEMO_ACTIVE_CAMPAIGN_ID,
        title: "Term-time school support",
        objective: "Pool gifts for verified school-fee requests during this term.",
        targetMinor: 25_000_000,
        currency: "KES",
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-11-30T20:59:00.000Z",
        eligibilityCriteria:
          "Published education requests with a completed recipient verification and a remaining gap.",
        beneficiarySelectionRules:
          "Administrators compare published education requests against the written criteria: verified status, remaining gap, and county coverage. Every allocation stores the reason it was chosen. Jirani does not draw beneficiaries at random.",
        feeDisclosure:
          "No platform fee is being collected. A future rule would be shown before a donor confirms a gift.",
        refundPolicy:
          "A simulated gift can be reversed by an administrator with a recorded reason. The original entry stays in the ledger.",
        surplusPolicy:
          "Any surplus stays with the campaign until reconciliation. It is not paid out when the end date passes.",
        status: "active",
        demo: true,
      },
      {
        id: DEMO_CLOSED_CAMPAIGN_ID,
        title: "Community kitchen — October",
        objective: "Buy food for a shared kitchen serving neighbours during October.",
        targetMinor: 8_000_000,
        currency: "KES",
        startsAt: "2026-10-01T00:00:00.000Z",
        endsAt: "2026-10-20T20:59:00.000Z",
        eligibilityCriteria: "A named community kitchen with a published plan and a verified organiser.",
        beneficiarySelectionRules:
          "The organiser is recorded in the private file. Public reporting names the kitchen's county and the goods to be bought, after an administrator records the decision.",
        feeDisclosure: "No platform fee is being collected in this demonstration.",
        refundPolicy: "Unused simulated gifts wait for an administrator to record a refund or a later allocation.",
        surplusPolicy: "Closing the campaign does not send the balance anywhere.",
        status: "closed",
        demo: true,
      },
      {
        id: DEMO_REPORTED_CAMPAIGN_ID,
        title: "Community kitchen — September",
        objective: "Demonstration of a campaign that has a published reconciliation report.",
        targetMinor: 5_000_000,
        currency: "KES",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-09-30T20:59:00.000Z",
        eligibilityCriteria: "Same written criteria as the October kitchen campaign.",
        beneficiarySelectionRules:
          "The report lists the recorded allocation and the reason. It does not claim that a bank or M-Pesa transfer was sent.",
        feeDisclosure: "No platform fee was collected.",
        refundPolicy: "No refund was requested in this demonstration.",
        surplusPolicy: "The recorded approval is not a transfer.",
        status: "reported",
        demo: true,
      },
    ],
    contributions: [
      gift({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        donorId: DEMO_DONOR_ID,
        requestId: DEMO_SCHOOL_REQUEST_ID,
        giftMinor: 400_000,
        recognition: "public",
        publicName: "Wanjiku (demonstration)",
        createdAt: "2026-10-14T10:00:00.000Z",
      }),
      gift({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        donorId: DEMO_NEIGHBOUR_ID,
        requestId: DEMO_SCHOOL_REQUEST_ID,
        giftMinor: 200_000,
        recognition: "anonymous",
        publicName: null,
        createdAt: "2026-10-15T10:00:00.000Z",
      }),
      gift({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
        donorId: DEMO_DONOR_ID,
        campaignId: DEMO_ACTIVE_CAMPAIGN_ID,
        giftMinor: 500_000,
        recognition: "public",
        publicName: "Wanjiku (demonstration)",
        createdAt: "2026-10-16T10:00:00.000Z",
      }),
      gift({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
        donorId: DEMO_DONOR_ID,
        campaignId: DEMO_CLOSED_CAMPAIGN_ID,
        giftMinor: 1_000_000,
        recognition: "anonymous",
        publicName: null,
        createdAt: "2026-10-18T10:00:00.000Z",
      }),
      gift({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
        donorId: DEMO_DONOR_ID,
        campaignId: DEMO_REPORTED_CAMPAIGN_ID,
        giftMinor: 1_500_000,
        recognition: "public",
        publicName: "Wanjiku (demonstration)",
        createdAt: "2026-09-20T10:00:00.000Z",
      }),
    ],
    refunds: [],
    disbursements: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
        campaignId: DEMO_REPORTED_CAMPAIGN_ID,
        requestId: null,
        beneficiaryOwnerId: DEMO_OTHER_RECIPIENT_ID,
        amountMinor: 1_500_000,
        currency: "KES",
        status: "approved",
        fundsSent: false,
        providerTransferReference: null,
        reason: "Demonstration approval after reconciliation. No payment provider was asked to send money.",
        decidedBy: DEMO_ADMIN_ID,
        createdAt: "2026-10-02T10:00:00.000Z",
      },
    ],
    reports: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
        campaignId: DEMO_REPORTED_CAMPAIGN_ID,
        narrative:
          "Demonstration report. Gifts and the disbursement approval are simulated. No M-Pesa or bank transfer was made, and the gross gifts are not platform revenue.",
        grossGiftMinor: 1_500_000,
        platformFeeMinor: 0,
        netGiftMinor: 1_500_000,
        disbursementApprovedMinor: 1_500_000,
        currency: "KES",
        publishedAt: "2026-10-03T10:00:00.000Z",
        publishedBy: DEMO_ADMIN_ID,
        demo: true,
      },
    ],
    allocations: [
      {
        id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
        campaignId: DEMO_REPORTED_CAMPAIGN_ID,
        requestId: null,
        description: "Food purchase plan for a demonstration kitchen in Nairobi County.",
        amountMinor: 1_500_000,
        rationale: "The written criteria were met and the amount matched the simulated gifts. This is not a random draw.",
        approvedBy: DEMO_ADMIN_ID,
        approvedAt: "2026-10-02T09:00:00.000Z",
      },
    ],
    evidence: [
      {
        id: "99999999-9999-4999-8999-999999999991",
        requestId: DEMO_DRAFT_REQUEST_ID,
        ownerId: DEMO_RECIPIENT_ID,
        fileName: "demo-bill.pdf",
        contentType: "application/pdf",
        byteSize: 12000,
        sha256: "abc123demo",
        storageKey: null,
        createdAt: AT,
      },
    ],
    verifications: [
      { profileId: DEMO_RECIPIENT_ID, status: "verified", legalName: "Demo Recipient" },
      { profileId: DEMO_OTHER_RECIPIENT_ID, status: "verified", legalName: "Demo Neighbour" },
    ],
    consents: [],
    complaints: [],
    audit: [],
  };
}
