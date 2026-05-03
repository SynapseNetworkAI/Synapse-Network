const configuredDocsBaseUrl = process.env.NEXT_PUBLIC_DOCS_BASE_URL;
const appEnv = process.env.NEXT_PUBLIC_APP_ENV;

function defaultDocsBaseUrl() {
  if (appEnv === "prod" || appEnv === "production") {
    return "https://docs.synapse-network.ai";
  }
  if (appEnv === "staging") {
    return "https://docs-staging.synapse-network.ai";
  }
  return "http://localhost:3001";
}

export function getDocsBaseUrl() {
  return (configuredDocsBaseUrl || defaultDocsBaseUrl()).replace(/\/+$/, "");
}

export function getDocsPath(path = "") {
  const normalized = path
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/^docs\/?/, "")
    .replace(/^getting-started\/consumer(?=\/|$)/, "get-started/agent-builders")
    .replace(/^getting-started\/provider(?=\/|$)/, "get-started/api-providers")
    .replace(/^getting-started(?=\/|$)/, "get-started")
    .replace(/^sdk(?=\/|$)/, "sdks")
    .replace(/^contracts(?=\/|$)/, "smart-contracts");

  return normalized ? `/${normalized}` : "";
}

export function getDocsUrl(path = "") {
  return `${getDocsBaseUrl()}${getDocsPath(path)}`;
}
