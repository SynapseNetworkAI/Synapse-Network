import { redirect } from "next/navigation";

export default function AgentWorkspaceRedirect() {
  redirect("/dashboard/overview");
}