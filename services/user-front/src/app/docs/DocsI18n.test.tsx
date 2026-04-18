// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";

import { DocsNavigationFeedbackProvider } from "@/app/docs/DocsNavigationFeedback";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import DocsTopNav from "@/app/docs/components/DocsTopNav";
import DocsNotFound from "@/app/docs/not-found";
import DocsOverviewPage from "@/app/docs/page";
import GettingStartedOverviewPage from "@/app/docs/getting-started/page";
import ConsumerGuidePage from "@/app/docs/getting-started/consumer/page";
import ProviderGuidePage from "@/app/docs/getting-started/provider/page";
import ConceptsPage from "@/app/docs/concepts/page";
import ApiReferencePage from "@/app/docs/api-reference/page";
import SdkPage from "@/app/docs/sdk/page";
import TypeScriptSdkPage from "@/app/docs/sdk/typescript/page";
import PythonSdkPage from "@/app/docs/sdk/python/page";
import ContractsPage from "@/app/docs/contracts/page";

const { pushMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  pathnameMock: vi.fn(() => "/docs"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
  usePathname: () => pathnameMock(),
}));

vi.mock("@/app/docs/use-active-section", () => ({
  useActiveSection: vi.fn(),
}));

function renderWithLanguage(ui: ReactElement, lang: "en" | "zh") {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, lang);
  return render(
    createElement(
      LanguageProvider,
      null,
      createElement(DocsNavigationFeedbackProvider, null, ui),
    )
  );
}

describe("docs multilingual surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue("/docs");
    globalThis.localStorage.clear();
  });

  it("renders top navigation in Chinese", async () => {
    renderWithLanguage(createElement(DocsTopNav), "zh");

    expect(await screen.findByText("概览")).toBeTruthy();
    expect(screen.getByText("快速开始")).toBeTruthy();
    expect(screen.getByText("搜索文档...")).toBeTruthy();
  });

  it("renders overview page in Chinese", async () => {
    renderWithLanguage(createElement(DocsOverviewPage), "zh");

    expect(await screen.findByRole("heading", { name: "Synapse Developer Platform" })).toBeTruthy();
    expect(screen.getByText("开发者文档")).toBeTruthy();
    expect(screen.getByRole("button", { name: /快速开始/i })).toBeTruthy();
  });

  it("renders getting started overview in English", async () => {
    renderWithLanguage(createElement(GettingStartedOverviewPage), "en");

    expect(await screen.findByRole("heading", { name: "Choose your role" })).toBeTruthy();
    expect(screen.getByText("Service consumer")).toBeTruthy();
    expect(screen.getByText("Provider Guide")).toBeTruthy();
  });

  it("renders consumer guide in Chinese", async () => {
    renderWithLanguage(createElement(ConsumerGuidePage), "zh");

    expect(await screen.findByRole("heading", { name: "Consumer Quick Start" })).toBeTruthy();
    expect(screen.getByText("服务调用者引导")).toBeTruthy();
    expect(screen.getByText("连接钱包并获取 JWT")).toBeTruthy();
    expect(screen.getByText(/Agent 可读的可调用服务注册表/)).toBeTruthy();
    expect(screen.getByText("Consumer 引导完成")).toBeTruthy();
  });

  it("renders provider guide in English", async () => {
    renderWithLanguage(createElement(ProviderGuidePage), "en");

    expect(await screen.findByRole("heading", { name: "Provider Quick Start" })).toBeTruthy();
    expect(screen.getByText("Service provider guide")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "TypeScript SDK" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Python SDK" })).toBeTruthy();
    expect(screen.getAllByText("Issue a provider secret").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Register your service").length).toBeGreaterThan(0);
    expect(screen.getByText(/keeps probing in slow lane/i)).toBeTruthy();
    expect(screen.getByText(/Force probe bypasses slow lane/i)).toBeTruthy();
    expect(screen.getByText("Provider guide complete")).toBeTruthy();
  });

  it("renders concepts, api, sdk, and contracts headings in English", async () => {
    renderWithLanguage(
      createElement("div", null,
        createElement(ConceptsPage),
        createElement(ApiReferencePage),
        createElement(SdkPage),
        createElement(TypeScriptSdkPage),
        createElement(PythonSdkPage),
        createElement(ContractsPage),
      ),
      "en",
    );

    expect(await screen.findByRole("heading", { name: "How Synapse Works" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "REST API" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "SDKs" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "TypeScript SDK" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { name: "Python SDK" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { name: "Smart Contracts" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Expose narrow agent credentials, not owner wallets")).toBeTruthy();
    expect(screen.getByText("Export callable marketplace services")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Discover services first" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Known serviceId? Call it directly" })).toBeTruthy();
    expect(screen.getByText(/official free starter services/i)).toBeTruthy();
  });

  it("renders docs 404 in Chinese", async () => {
    renderWithLanguage(createElement(DocsNotFound), "zh");

    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /返回文档首页/i })).toBeTruthy();
  });
});
