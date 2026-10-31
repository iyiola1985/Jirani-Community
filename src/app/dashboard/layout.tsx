import { Suspense } from "react";

import { RoleSwitcher } from "@/components/layout/role-switcher";

export const instant = false;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <RoleSwitcher />
      </Suspense>
      {children}
    </>
  );
}
