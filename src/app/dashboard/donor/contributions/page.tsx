import { redirect } from "next/navigation";

export const metadata = { title: "Contribution history" };

export default function ContributionHistoryPage() {
  redirect("/dashboard/donor");
}
