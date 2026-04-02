import WalletAuthGuard from "@/components/WalletAuthGuard";
import {
  DashboardNavigationFeedbackProvider,
  DashboardNavigationLoadingOverlay,
} from "@/components/dashboard/DashboardNavigationFeedback";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import RoleGuard from "@/components/RoleGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletAuthGuard>
      <DashboardNavigationFeedbackProvider>
        <div className="flex bg-[#050505] min-h-[calc(100vh-60px)]">
          <DashboardSidebar />
          <main className="relative min-w-0 flex-1 overflow-x-hidden">
            <DashboardNavigationLoadingOverlay />
            <RoleGuard>
              {children}
            </RoleGuard>
          </main>
        </div>
      </DashboardNavigationFeedbackProvider>
    </WalletAuthGuard>
  );
}
