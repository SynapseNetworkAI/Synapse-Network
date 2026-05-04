// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import RolePathCards from "@/components/dashboard/overview/RolePathCards";
import { renderWithLanguage } from "@/test/renderWithLanguage";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => createElement("a", { href, ...rest }, children),
}));

describe("RolePathCards i18n", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the owner/provider onboarding cards in English", () => {
    renderWithLanguage(createElement(RolePathCards), "en");

    expect(screen.getByText("Owner / Agent onboarding")).toBeTruthy();
    expect(screen.getByText("Provider onboarding")).toBeTruthy();
    expect(
      screen.getByText("Connect wallet and complete signature login")
    ).toBeTruthy();
    expect(screen.getByText("Open Agent Workspace")).toBeTruthy();
    expect(screen.queryByText("Owner / Agent 接入")).toBeNull();
    expect(screen.queryByText("连接钱包并完成签名登录")).toBeNull();
  });

  it("renders the owner/provider onboarding cards in Chinese", () => {
    renderWithLanguage(createElement(RolePathCards), "zh");

    expect(screen.getByText("Owner / Agent 接入")).toBeTruthy();
    expect(screen.getByText("Provider 接入")).toBeTruthy();
    expect(screen.getByText("连接钱包并完成签名登录")).toBeTruthy();
    expect(screen.getByText("进入 Agent Workspace")).toBeTruthy();
    expect(screen.queryByText("Owner / Agent onboarding")).toBeNull();
    expect(
      screen.queryByText("Connect wallet and complete signature login")
    ).toBeNull();
  });
});
