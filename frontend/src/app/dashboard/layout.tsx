import ClientGuard from "@/components/ClientGuard";
import WalletGuard from "@/components/WalletGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientGuard>
      <WalletGuard>{children}</WalletGuard>
    </ClientGuard>
  );
}
