import WalletAuthGuard from "@/components/WalletAuthGuard";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import RoleGuard from "@/components/RoleGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletAuthGuard>
      <div className="flex bg-[#050505] min-h-[calc(100vh-73px)]">
        <DashboardSidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <RoleGuard>
            {children}
          </RoleGuard>
        </main>
      </div>
    </WalletAuthGuard>
  );
}
