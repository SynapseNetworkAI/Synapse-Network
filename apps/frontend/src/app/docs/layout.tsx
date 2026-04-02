import { DocsActiveProvider } from "./active-context";
import DocsSidebar from "./components/DocsSidebar";
import DocsTopNav from "./components/DocsTopNav";

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocsActiveProvider>
      {/* Dedicated docs navbar replaces the global marketing/console Navbar */}
      <DocsTopNav />

      {/* 56px top bar + 44px tab bar = 100px total */}
      <div className="flex min-h-screen" style={{ paddingTop: "100px" }}>
        <DocsSidebar />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-12">
            {children}
          </div>
        </main>
      </div>
    </DocsActiveProvider>
  );
}
