import WalletAuthGuard from "@/components/WalletAuthGuard";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import RoleGuard from "@/components/RoleGuard";

export default function ProviderLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <WalletAuthGuard>
      <div className="flex bg-[#050505] min-h-[calc(100vh-60px)]">
        <DashboardSidebar />
        <main className="flex-1 overflow-x-hidden">
          <RoleGuard>
            {children}
          </RoleGuard>
        </main>
      </div>
    </WalletAuthGuard>
  );
}
