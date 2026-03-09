import WalletAuthGuard from "@/components/WalletAuthGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletAuthGuard>{children}</WalletAuthGuard>;
}
