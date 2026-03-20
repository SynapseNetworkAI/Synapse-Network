import { redirect } from "next/navigation";

export default function DashboardConsoleRedirect() {
	redirect("/dashboard/developer");
}