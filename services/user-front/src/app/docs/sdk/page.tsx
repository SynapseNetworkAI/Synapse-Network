"use client";

import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useActiveSection } from "../use-active-section";
import { useDocsPageNav } from "../use-docs-page-nav";
import {
  CapabilityCoverageSection,
  OverviewSection,
  QuickstartSection,
  SnippetSection,
  StagingDocsSection,
} from "./sdkPageSections";
import { buildSdkCards, SdkCardSection } from "./sdkPageCards";

const PAGE_SECTIONS = [
  "sdk-overview",
  "sdk-reference",
  "sdk-wave1",
  "sdk-snippets",
  "sdk-staging-docs",
  "sdk-compare",
];

export default function SdkPage() {
  const router = useRouter();
  const { t, tList } = useLanguage();

  useActiveSection(PAGE_SECTIONS, "sdk-overview");
  useDocsPageNav([
    {
      id: "sdk-overview",
      label: tList("docsPage.sidebarItemLabels")[24] ?? "SDK Overview",
    },
    { id: "sdk-reference", label: t("docsPage.sdkReferenceTitle") },
    { id: "sdk-wave1", label: t("docsPage.sdkWave1Title") },
    { id: "sdk-snippets", label: t("docsPage.sdkSnippetTitle") },
    { id: "sdk-compare", label: t("docsPage.sdkCompareTitle") },
  ]);

  const cards = buildSdkCards();

  return (
    <div className="space-y-16">
      <OverviewSection t={t} />
      <SdkCardSection
        id="sdk-reference"
        title={t("docsPage.sdkReferenceTitle")}
        description={t("docsPage.sdkReferenceDescription")}
        cards={cards.filter((card) => !card.external)}
        capabilityLabel="Core coverage"
        ctaLabel={t("docsPage.sdkOpenDocsCta")}
        onOpen={(href) => router.push(href)}
        columns="xl:grid-cols-2"
      />
      <SdkCardSection
        id="sdk-wave1"
        title={t("docsPage.sdkWave1Title")}
        description={t("docsPage.sdkWave1Description")}
        cards={cards.filter((card) => card.external)}
        capabilityLabel="Core coverage"
        ctaLabel={t("docsPage.sdkViewGithubCta")}
        columns="xl:grid-cols-3"
        framed
      />
      <SnippetSection t={t} />
      <QuickstartSection
        t={t}
        steps={tList("docsPage.sdkAgentQuickstartSteps")}
      />
      <StagingDocsSection
        t={t}
        labels={tList("docsPage.sdkStagingDocsLinkLabels")}
      />
      <CapabilityCoverageSection
        t={t}
        sdkLabels={[
          t("docsPage.sdkTsTitle"),
          t("docsPage.sdkPyTitle"),
          "Go",
          "Java/JVM",
          ".NET",
        ]}
      />
      <div className="h-16" />
    </div>
  );
}
