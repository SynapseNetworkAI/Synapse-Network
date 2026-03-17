import { redirect } from "next/navigation";

export default function BuyerOverviewRedirect() {
  redirect("/dashboard/overview");
}