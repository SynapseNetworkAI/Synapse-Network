"use client";

import { List } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useDocsActive } from "../active-context";

export default function DocsOnThisPage() {
  const { t } = useLanguage();
  const { activeId, pageNavItems, setActiveId } = useDocsActive();

  if (pageNavItems.length === 0) {
    return null;
  }

  const selectedId = activeId || pageNavItems[0]?.id;

  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }

    setActiveId(id);
    element.scrollIntoView({ behavior: "smooth", block: "start" });

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${window.location.pathname}#${id}`);
    }
  };

  return (
    <aside
      data-testid="docs-on-this-page"
      className="hidden xl:flex w-[220px] shrink-0 self-start sticky top-[100px] h-[calc(100vh-100px)]"
      aria-label={t("docsPage.onThisPageTitle")}
    >
      <div
        data-testid="docs-on-this-page-rail"
        className="w-full self-start"
      >
        <div className="max-h-full overflow-y-auto rounded-[18px] border border-white/[0.06] bg-[#090a0c] px-4 py-4">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-[#e7e9ea]">
            <List size={14} className="text-[#8b98a5]" />
            {t("docsPage.onThisPageTitle")}
          </div>
          <div className="space-y-1.5">
            {pageNavItems.map((item) => {
              const active = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => jumpTo(item.id)}
                  className="block w-full rounded-xl px-3 py-2 text-left text-[13px] leading-6 transition-colors"
                  style={{
                    color: active ? "#e7e9ea" : "#8b98a5",
                    background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
