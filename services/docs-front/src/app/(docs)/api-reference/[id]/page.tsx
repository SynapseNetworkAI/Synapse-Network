import { CodeTabs } from "@/components/docs/CodeTabs";
import { FumadocsOperation } from "@/components/docs/FumadocsOperation";
import apiReference from "@/data/api-reference.json";
import { gatewayBaseUrl, siteUrl } from "@/lib/shared";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Route = (typeof apiReference.routes)[number];

const authLabel: Record<string, string> = {
  none: "No auth",
  jwt: "Wallet JWT",
  credential: "Agent credential",
};

function getRoute(id: string): Route | undefined {
  return apiReference.routes.find((route) => route.id === id);
}

function curlSample(route: Route) {
  const headers = [
    route.auth === "jwt" ? `  -H "Authorization: Bearer $SYNAPSE_JWT"` : "",
    route.auth === "credential"
      ? `  -H "X-Synapse-Agent-Credential: $SYNAPSE_AGENT_CREDENTIAL"`
      : "",
    route.bodyExample ? `  -H "Content-Type: application/json"` : "",
  ].filter(Boolean);
  const body = route.bodyExample
    ? [`  -d '${JSON.stringify(route.bodyExample, null, 2)}'`]
    : [];
  const method = route.method === "GET" ? "" : `  -X ${route.method}`;

  return [`curl "${gatewayBaseUrl}${route.path}"`, method, ...headers, ...body]
    .filter(Boolean)
    .join(" \\\n");
}

function tsSample(route: Route) {
  const body = route.bodyExample
    ? `,\n  body: JSON.stringify(${JSON.stringify(
        route.bodyExample,
        null,
        2
      )}),`
    : "";
  const headers = [
    route.auth === "jwt" ? `Authorization: \`Bearer \${synapseJwt}\`` : "",
    route.auth === "credential"
      ? `"X-Synapse-Agent-Credential": synapseAgentCredential`
      : "",
    route.bodyExample ? `"Content-Type": "application/json"` : "",
  ].filter(Boolean);

  return `const response = await fetch(\`${gatewayBaseUrl}${route.path}\`, {
  method: "${route.method}",
  headers: {
    ${headers.join(",\n    ")}
  }${body}
});

const data = await response.json();`;
}

function pythonSample(route: Route) {
  const headers = [
    route.auth === "jwt" ? `"Authorization": f"Bearer {synapse_jwt}"` : "",
    route.auth === "credential"
      ? `"X-Synapse-Agent-Credential": synapse_agent_credential`
      : "",
    route.bodyExample ? `"Content-Type": "application/json"` : "",
  ].filter(Boolean);
  const jsonArg = route.bodyExample
    ? `,\n    json=${JSON.stringify(route.bodyExample, null, 4)}`
    : "";

  return `import requests

response = requests.request(
    "${route.method}",
    "${gatewayBaseUrl}${route.path}",
    headers={
        ${headers.join(",\n        ")}
    }${jsonArg}
)
data = response.json()`;
}

export function generateStaticParams() {
  return apiReference.routes.map((route) => ({ id: route.id }));
}

export async function generateMetadata(
  props: PageProps<"/api-reference/[id]">
): Promise<Metadata> {
  const params = await props.params;
  const route = getRoute(params.id);
  if (!route) return {};

  return {
    title: route.summary,
    description: route.description,
    alternates: {
      canonical: `${siteUrl}/api-reference/${route.id}`,
    },
  };
}

export default async function ApiEndpointPage(
  props: PageProps<"/api-reference/[id]">
) {
  const params = await props.params;
  const route = getRoute(params.id);
  if (!route) notFound();

  return (
    <DocsPage toc={[]} full>
      <DocsTitle>{route.summary}</DocsTitle>
      <DocsDescription>{route.description}</DocsDescription>
      <DocsBody>
        <div className="not-prose mb-8 flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-2.5 py-1 font-mono text-xs font-semibold text-[#7ff7be]">
            {route.method}
          </span>
          <span className="rounded-[8px] border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 font-mono text-xs text-fd-muted-foreground">
            {route.path}
          </span>
          <span className="rounded-[8px] border border-white/[0.08] px-2.5 py-1 text-xs text-fd-muted-foreground">
            {authLabel[route.auth] ?? route.auth}
          </span>
          {route.idempotency ? (
            <span className="rounded-[8px] border border-[#f9c74f]/25 bg-[#f9c74f]/10 px-2.5 py-1 text-xs text-[#f9c74f]">
              Idempotent
            </span>
          ) : null}
        </div>

        <div className="not-prose grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-6">
            <section className="rounded-[10px] border border-white/[0.08] bg-[#050708] p-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7ff7be]">
                For AI agents
              </p>
              <p className="text-sm leading-7 text-fd-muted-foreground">
                {route.agentMeta.note}
              </p>
              {route.agentMeta.requires ? (
                <p className="mt-3 text-sm leading-7 text-fd-muted-foreground">
                  <span className="font-semibold text-fd-foreground">
                    Requires:
                  </span>{" "}
                  {route.agentMeta.requires}
                </p>
              ) : null}
              {route.agentMeta.next ? (
                <p className="mt-3 text-sm leading-7 text-fd-muted-foreground">
                  <span className="font-semibold text-fd-foreground">
                    Next:
                  </span>{" "}
                  {route.agentMeta.next}
                </p>
              ) : null}
            </section>

            {route.params?.length ? (
              <section>
                <h2>Parameters</h2>
                <div className="not-prose overflow-hidden rounded-[10px] border border-white/[0.08]">
                  {route.params.map((param) => (
                    <div
                      key={`${param.in}-${param.name}`}
                      className="grid gap-2 border-b border-white/[0.08] p-4 last:border-b-0 md:grid-cols-[160px_minmax(0,1fr)]"
                    >
                      <div>
                        <code>{param.name}</code>
                        <p className="mt-1 text-xs text-fd-muted-foreground">
                          {param.in} ·{" "}
                          {param.required ? "required" : "optional"}
                        </p>
                      </div>
                      <p className="text-sm leading-6 text-fd-muted-foreground">
                        {param.description}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h2>Generated OpenAPI reference</h2>
              <FumadocsOperation
                document="openapi"
                showTitle={false}
                showDescription={false}
                operations={[
                  {
                    path: route.openApiPath,
                    method: route.method.toLowerCase() as never,
                  },
                ]}
              />
            </section>

            <div className="not-prose">
              <Link
                href="/api-reference"
                className="text-sm font-semibold text-[#7ff7be] hover:underline"
              >
                Back to API Reference
              </Link>
            </div>
          </div>

          <aside className="xl:sticky xl:top-24 xl:self-start">
            <CodeTabs
              tabs={[
                { label: "cURL", code: curlSample(route) },
                { label: "TypeScript", code: tsSample(route) },
                { label: "Python", code: pythonSample(route) },
              ]}
            />
          </aside>
        </div>
      </DocsBody>
    </DocsPage>
  );
}
