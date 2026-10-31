import "server-only";

import { scryptSync, timingSafeEqual } from "node:crypto";

import { isDemoMode } from "@/config/brand";
import { DEMO_ADMIN_ID, DEMO_DONOR_ID, DEMO_RECIPIENT_ID } from "@/data/demo";
import type { Actor, Role } from "@/domain/types";

const SALT = "jirani-demo-v1";

type DemoAccount = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  roles: readonly Role[];
};

const ACCOUNTS: readonly DemoAccount[] = [
  {
    id: DEMO_RECIPIENT_ID,
    email: "recipient@demo.jirani.test",
    passwordHash: "b359b16d0077475b1bb55657b7f7a4f886a451102e0664bdec3b99173c0f66a4",
    displayName: "Achieng (demonstration)",
    roles: ["recipient"],
  },
  {
    id: DEMO_DONOR_ID,
    email: "donor@demo.jirani.test",
    passwordHash: "18028bb0399aff3d4c2b8365a4debf23dcaae04f6bc50ac718a6e91cbfcf2a69",
    displayName: "Wanjiku (demonstration)",
    roles: ["donor"],
  },
  {
    id: DEMO_ADMIN_ID,
    email: "admin@demo.jirani.test",
    passwordHash: "82861cfae2f8f3b267a5afff6da2fb444d48eb65bbcfdc606bf55cdce6662ccc",
    displayName: "Otieno (demonstration)",
    roles: ["administrator"],
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    email: "corporate@demo.jirani.test",
    passwordHash: "a02634fb8938ed218bf7c08dc8cec4abe916910fee5de9cc0bfc67dcb5d9b6d9",
    displayName: "Shola Supplies (demonstration)",
    roles: ["corporate_partner"],
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    email: "both@demo.jirani.test",
    passwordHash: "c67c2acd3b14db22db0d66de6ef7f5e50d9df39fe1303144ad164cd7401bab9c",
    displayName: "Nyambura (demonstration)",
    roles: ["recipient", "donor"],
  },
];

export const DEMO_LOGIN_HINTS = [
  { role: "Recipient", email: "recipient@demo.jirani.test", password: "demo-recipient" },
  { role: "Donor", email: "donor@demo.jirani.test", password: "demo-donor" },
  { role: "Corporate partner", email: "corporate@demo.jirani.test", password: "demo-corporate" },
  { role: "Recipient and donor", email: "both@demo.jirani.test", password: "demo-both" },
  { role: "Administrator", email: "admin@demo.jirani.test", password: "demo-admin" },
] as const;

export function authenticateDemo(email: string, password: string): Actor | null {
  if (process.env.NODE_ENV === "production" || !isDemoMode()) return null;
  const account = ACCOUNTS.find((item) => item.email === email.trim().toLowerCase());
  if (!account) return null;
  const actual = scryptSync(password, SALT, 32);
  const expected = Buffer.from(account.passwordHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { id: account.id, roles: account.roles, displayName: account.displayName };
}

export function findDemoActor(profileId: string): Actor | null {
  if (process.env.NODE_ENV === "production" || !isDemoMode()) return null;
  const account = ACCOUNTS.find((item) => item.id === profileId);
  if (!account) return null;
  return { id: account.id, roles: account.roles, displayName: account.displayName };
}
