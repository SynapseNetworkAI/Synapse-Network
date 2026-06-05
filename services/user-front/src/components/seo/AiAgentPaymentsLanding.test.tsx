// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { AiAgentPaymentsLanding } from "@/components/seo/AiAgentPaymentsLanding";
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

describe("AiAgentPaymentsLanding MCP pages", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the MCP landing copy in English", () => {
    renderWithLanguage(
      createElement(AiAgentPaymentsLanding, { mode: "mcp" }),
      "en",
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "MCP server for paid API calls.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Use Synapse Remote MCP when ChatGPT, Claude, Grok, Codex/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText("用于 paid API calls 的 MCP server。"),
    ).toBeNull();
  });

  it("renders the MCP landing copy in Chinese", () => {
    renderWithLanguage(
      createElement(AiAgentPaymentsLanding, { mode: "mcp" }),
      "zh",
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "用于 paid API calls 的 MCP server。",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/使用 Synapse Remote MCP。/),
    ).toBeTruthy();
    expect(screen.queryByText("MCP server for paid API calls.")).toBeNull();
  });

  it("renders the ChatGPT MCP landing copy in English", () => {
    renderWithLanguage(
      createElement(AiAgentPaymentsLanding, { mode: "chatgptMcp" }),
      "en",
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "ChatGPT MCP app for API payments.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Register Synapse Remote MCP as a ChatGPT custom MCP app/),
    ).toBeTruthy();
    expect(
      screen.queryByText("用于 API payments 的 ChatGPT MCP app。"),
    ).toBeNull();
  });

  it("renders the ChatGPT MCP landing copy in Chinese", () => {
    renderWithLanguage(
      createElement(AiAgentPaymentsLanding, { mode: "chatgptMcp" }),
      "zh",
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "用于 API payments 的 ChatGPT MCP app。",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/把 Synapse Remote MCP 注册为 ChatGPT custom MCP app/),
    ).toBeTruthy();
    expect(
      screen.queryByText("ChatGPT MCP app for API payments."),
    ).toBeNull();
  });
});
