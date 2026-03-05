import ClientGuard from "@/components/ClientGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientGuard>{children}</ClientGuard>;
}
