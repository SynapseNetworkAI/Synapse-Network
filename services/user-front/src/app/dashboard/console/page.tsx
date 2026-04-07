import { redirect } from "next/navigation";

export default function DashboardConsoleRedirect() {
	redirect("/provider/console");
}