import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { AgentNote, WarningNote } from "./docs/AgentNote";
import { EndpointDirectory } from "./docs/EndpointDirectory";
import {
  EnvironmentConfigSummary,
  EnvironmentNetworksTable,
  GatewayEnvExport,
  McpEnvironmentExample,
} from "./docs/EnvironmentConfig";
import { QuickLinks, StatLine } from "./docs/QuickLinks";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    AgentNote,
    WarningNote,
    EndpointDirectory,
    EnvironmentConfigSummary,
    EnvironmentNetworksTable,
    GatewayEnvExport,
    McpEnvironmentExample,
    QuickLinks,
    StatLine,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
