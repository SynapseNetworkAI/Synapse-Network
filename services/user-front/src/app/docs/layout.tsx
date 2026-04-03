import {
  DocsNavigationFeedbackProvider,
  DocsNavigationLoadingOverlay,
} from "./DocsNavigationFeedback";
import { DocsActiveProvider } from "./active-context";
import DocsOnThisPage from "./components/DocsOnThisPage";
import DocsSidebar from "./components/DocsSidebar";
import DocsTopNav from "./components/DocsTopNav";
import { DocsContentWrapper } from "./components/DocsContentWrapper";

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocsNavigationFeedbackProvider>
      <DocsActiveProvider>
        {/* Dedicated docs navbar replaces the global marketing/console Navbar */}
        <DocsTopNav />

        {/* 56px top bar + 44px tab bar = 100px total */}
        <div className="flex min-h-screen" style={{ paddingTop: "100px" }}>
          <DocsSidebar />
          <main className="relative flex-1 min-w-0 overflow-x-hidden">
            <DocsNavigationLoadingOverlay />
            <div className="mx-auto flex max-w-[1180px] justify-center gap-10 px-6 py-12 lg:px-10">
              <div className="min-w-0 max-w-[900px] flex-1">
                <DocsContentWrapper>
                  {children}
                </DocsContentWrapper>
              </div>
              <DocsOnThisPage />
            </div>
          </main>
        </div>
      </DocsActiveProvider>
    </DocsNavigationFeedbackProvider>
  );
}
