import { DocsActiveProvider } from "./active-context";
import DocsSidebar from "./components/DocsSidebar";

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocsActiveProvider>
      <div className="flex min-h-screen" style={{ paddingTop: "56px" }}>
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
