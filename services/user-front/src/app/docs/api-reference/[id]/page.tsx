"use client";

import Link from "next/link";
import { useState, useCallback, useMemo } from "react";
import { Copy, Check, ChevronLeft, ArrowRight, Play, ChevronDown, Sparkles } from "lucide-react";
import {
  ALL_ROUTES,
  buildCurl,
  METHOD_BG,
  ROLE_BADGE,
  PHASE_BADGE,
  type RouteEndpoint,
  type RouteParam,
  type AgentMeta,
  type ErrorCode,
} from "../endpoint-data";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

// ─── small shared components ──────────────────────────────────────────────────

function SectionDivider({ title }: { title: string }) {
  return (
    <h4 className="text-[15px] font-semibold text-[#e7e9ea] pt-2 pb-1">
      {title}
    </h4>
  );
}

const PARAM_LOC_CLR: Record<string, string> = {
  path: "text-[#c084fc] border-[#c084fc]/30 bg-[#c084fc]/8",
  query: "text-[#6eb6f6] border-[#6eb6f6]/30 bg-[#6eb6f6]/8",
  body: "text-[#f9c74f] border-[#f9c74f]/30 bg-[#f9c74f]/8",
  header: "text-[#7ff7be] border-[#7ff7be]/30 bg-[#7ff7be]/8",
};

function ParamBlock({
  param,
  value,
  onChange,
}: {
  param: RouteParam;
  value: string;
  onChange: (v: string) => void;
}) {
  const locCls = PARAM_LOC_CLR[param.in] ?? "text-[#71767b] border-[#71767b]/20 bg-[#71767b]/8";
  return (
    <div className="py-4 border-b border-white/[0.04] last:border-0">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <code className="text-[13px] font-mono font-semibold text-[#c0c5cc]">{param.name}</code>
        <span className="text-[11px] text-[#4e535a] font-mono">{param.type}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${locCls}`}>
          {param.in}
        </span>
        {param.required && (
          <span className="rounded border border-red-400/30 bg-red-400/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-400">
            required
          </span>
        )}
      </div>
      <p className="text-[13px] text-[#71767b] leading-[1.65] mb-2">{param.description}</p>
      {param.enum && param.enum.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {param.enum.map((v) => (
            <code key={v} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-[#9aa4af] font-mono">
              {v}
            </code>
          ))}
        </div>
      )}
      <input
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none transition-colors"
        placeholder={param.example ?? param.name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AgentBox({ meta }: { meta: AgentMeta }) {
  const role = ROLE_BADGE[meta.role] ?? ROLE_BADGE.public;
  const phaseCls = PHASE_BADGE[meta.phase] ?? "text-[#71767b] bg-[#71767b]/8 border-[#71767b]/20";
  return (
    <div className="rounded-lg border border-[#6eb6f6]/14 bg-[#6eb6f6]/[0.03] px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
          Agent Context
        </span>
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold ${role.cls}`}>
          {role.label}
        </span>
        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold capitalize ${phaseCls}`}
        >
          {meta.phase}
        </span>
      </div>
      <p className="text-[13px] leading-[1.65] text-[#8b98a5]">{meta.note}</p>
      {meta.requires && (
        <div className="flex gap-2 items-start">
          <span className="text-[10px] font-semibold text-[#4e535a] shrink-0 mt-0.5 uppercase tracking-wider">
            Requires
          </span>
          <span className="text-[12px] text-[#71767b] leading-5">{meta.requires}</span>
        </div>
      )}
      {meta.outputs && meta.outputs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4e535a]">Produces</div>
          {meta.outputs.map((o) => (
            <div key={o.key} className="flex gap-2 items-start">
              <code className="text-[11px] font-mono text-[#7ff7be] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded shrink-0">
                {o.key}
              </code>
              <span className="text-[12px] text-[#71767b] leading-5">{o.desc}</span>
            </div>
          ))}
        </div>
      )}
      {meta.next && (
        <div className="flex gap-2 items-start">
          <ArrowRight size={11} className="text-[#6eb6f6] shrink-0 mt-0.5" />
          <span className="text-[12px] text-[#6eb6f6] leading-5">{meta.next}</span>
        </div>
      )}
    </div>
  );
}

function errorBadgeCls(status: number): string {
  if (status >= 500) return "bg-red-400/10 text-red-400";
  if (status >= 400) return "bg-[#f9c74f]/10 text-[#f9c74f]";
  return "bg-[#7ff7be]/10 text-[#7ff7be]";
}

function ErrorTable({ errors }: { errors: ErrorCode[] }) {
  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      {errors.map((e, i) => (
        <div
          key={e.code}
          className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-white/[0.04]" : ""}`}
        >
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-mono font-semibold ${errorBadgeCls(e.status)}`}
          >
            {e.status}
          </span>
          <code className="text-[12px] font-mono text-[#c0c5cc] shrink-0">{e.code}</code>
          <span className="text-[13px] text-[#71767b] leading-5">{e.message}</span>
        </div>
      ))}
    </div>
  );
}

// cURL colour palette
const CURL_COLOR = {
  keyword: "#e7e9ea",  // curl
  flag:    "#6eb6f6",  // --request, --header, -X
  quoted:  "#f4a261",  // 'value'
  cont:    "#4e535a",  // \
  rest:    "#71767b",  // everything else
} as const;

// ─── cURL syntax highlighter ─────────────────────────────────────────────────

function CurlHighlight({ curl }: { curl: string }) {
  const tokens: { text: string; col: string }[] = [];
  const re = /(\bcurl\b)|(--?[\w-]+)|('(?:[^'\\]|\\.)*')|(\\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(curl)) !== null) {
    if (m.index > last) tokens.push({ text: curl.slice(last, m.index), col: CURL_COLOR.rest });
    if (m[1])      tokens.push({ text: m[1], col: CURL_COLOR.keyword });
    else if (m[2]) tokens.push({ text: m[2], col: CURL_COLOR.flag });
    else if (m[3]) tokens.push({ text: m[3], col: CURL_COLOR.quoted });
    else           tokens.push({ text: m[4]!, col: CURL_COLOR.cont });
    last = m.index + m[0].length;
  }
  if (last < curl.length) tokens.push({ text: curl.slice(last), col: CURL_COLOR.rest });
  return (
    <pre className="overflow-x-auto px-4 py-4 text-[11.5px] leading-[1.75] font-mono min-h-[80px] whitespace-pre">
      <code>{tokens.map((t, i) => <span key={i} style={{ color: t.col }}>{t.text}</span>)}</code>
    </pre>
  );
}

// ─── Right Panel: cURL card ───────────────────────────────────────────────────

function CurlCard({ route, curl }: { route: RouteEndpoint; curl: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#09090c] overflow-hidden">
      {/* card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0d0d10]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] font-medium text-[#c0c5cc] truncate">{route.summary}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button className="flex items-center gap-1 text-[11px] font-mono text-[#c0c5cc] border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1 rounded-md transition-colors">
            <span className="w-1.5 h-1.5 rounded-sm bg-[#71767b] inline-block mr-0.5" />
            cURL
            <ChevronDown size={10} className="text-[#71767b] ml-0.5" />
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-white/[0.07] text-[#71767b] hover:text-[#c0c5cc] transition-colors"
            aria-label="Copy cURL"
          >
            {copied ? <Check size={13} className="text-[#7ff7be]" /> : <Copy size={13} />}
          </button>
          <button className="p-1.5 rounded-md hover:bg-white/[0.07] text-[#4e535a] hover:text-[#71767b] transition-colors" aria-label="AI assist">
            <Sparkles size={13} />
          </button>
        </div>
      </div>
      {/* code */}
      <CurlHighlight curl={curl} />
    </div>
  );
}

// JSON colour palette (X-style: keys = near-white, strings = blue)
const JSON_COLOR = {
  key:   "#e7e9ea",  // "key":
  str:   "#6ab0f5",  // "string value"
  num:   "#e7e9ea",  // 123
  bool:  "#e7e9ea",  // true/false
  null:  "#71767b",  // null
  punct: "#6e7680",  // {}[],:
  ws:    "#9aa4af",  // whitespace / unmatched
} as const;

// ─── JSON syntax highlighter ────────────────────────────────────────────────

function JsonHighlight({ json }: { json: string }) {
  const tokens: { text: string; col: string }[] = [];
  const re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|(\{|\}|\[|\]|,|:)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) tokens.push({ text: json.slice(last, m.index), col: JSON_COLOR.ws });
    if (m[1])      tokens.push({ text: m[1], col: JSON_COLOR.key });
    else if (m[2]) tokens.push({ text: m[2], col: JSON_COLOR.str });
    else if (m[3]) tokens.push({ text: m[3], col: JSON_COLOR.num });
    else if (m[4]) tokens.push({ text: m[4], col: JSON_COLOR.bool });
    else if (m[5]) tokens.push({ text: m[5], col: JSON_COLOR.null });
    else           tokens.push({ text: m[6]!, col: JSON_COLOR.punct });
    last = m.index + m[0].length;
  }
  if (last < json.length) tokens.push({ text: json.slice(last), col: JSON_COLOR.ws });
  return (
    <pre className="overflow-x-auto px-4 py-4 text-[11.5px] leading-[1.75] font-mono max-h-[380px] overflow-y-auto">
      <code>
        {tokens.map((t, i) => <span key={i} style={{ color: t.col }}>{t.text}</span>)}
      </code>
    </pre>
  );
}

// ─── Right Panel: 200 response card ──────────────────────────────────────────

function ResponseCard({ route }: { route: RouteEndpoint }) {
  const [copied, setCopied] = useState(false);
  if (!route.responseExample) return null;
  const json = JSON.stringify(route.responseExample, null, 2);
  const handleCopy = () => {
    void navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#09090c] overflow-hidden">
      {/* tab header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0d0d10]">
        <div className="flex items-center gap-2">
          <span className="rounded px-2 py-0.5 text-[11px] font-mono font-bold bg-[#7ff7be]/12 text-[#7ff7be]">
            200
          </span>
          <span className="text-[12px] text-[#71767b]">default</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-white/[0.07] text-[#71767b] hover:text-[#c0c5cc] transition-colors"
            aria-label="Copy response"
          >
            {copied ? <Check size={13} className="text-[#7ff7be]" /> : <Copy size={13} />}
          </button>
          <button className="p-1.5 rounded-md hover:bg-white/[0.07] text-[#4e535a] hover:text-[#71767b] transition-colors" aria-label="AI assist">
            <Sparkles size={13} />
          </button>
        </div>
      </div>
      {/* json body */}
      <JsonHighlight json={json} />
    </div>
  );
}

// ─── Main endpoint detail ─────────────────────────────────────────────────────

function EndpointDetail({
  route,
  groupTitle,
}: {
  route: RouteEndpoint & { groupId: string; groupTitle: string };
  groupTitle: string;
}) {
  const [token, setToken] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (route.params ?? []).forEach((p) => {
      if (p.example) init[p.name] = p.example;
    });
    return init;
  });
  const [bodyText, setBodyText] = useState(
    route.bodyExample ? JSON.stringify(route.bodyExample, null, 2) : "",
  );
  const [liveResponse, setLiveResponse] = useState<{ status: number; body: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const gatewayUrl = getGatewayBaseUrl();
  const curl = useMemo(
    () => buildCurl(route, gatewayUrl, token, paramValues, bodyText),
    [route, gatewayUrl, token, paramValues, bodyText],
  );

  const handleSend = useCallback(async () => {
    setLoading(true);
    setLiveResponse(null);
    try {
      let url = `${gatewayUrl}${route.path}`;
      (route.params ?? []).filter((p) => p.in === "path").forEach((p) => {
        url = url.replace(`:${p.name}`, paramValues[p.name] ?? `:${p.name}`);
      });
      const qs = (route.params ?? [])
        .filter((p) => p.in === "query" && paramValues[p.name])
        .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`)
        .join("&");
      if (qs) url += `?${qs}`;

      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (route.idempotency) headers["X-Idempotency-Key"] = `idem-${Date.now()}`;
      if (["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim())
        headers["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method: route.method,
        headers,
        body:
          ["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim() ? bodyText : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* keep raw */
      }
      setLiveResponse({ status: res.status, body: pretty });
    } catch (e: unknown) {
      setLiveResponse({ status: 0, body: String(e) });
    } finally {
      setLoading(false);
    }
  }, [route, gatewayUrl, token, paramValues, bodyText]);

  const pathParams = (route.params ?? []).filter((p) => p.in === "path");
  const queryParams = (route.params ?? []).filter((p) => p.in === "query");
  const methodBg = METHOD_BG[route.method] ?? "bg-white/10 text-white";
  const roleBadge = ROLE_BADGE[route.agentMeta.role];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-10 items-start">
      {/* ── LEFT column ───────────────────────────────────── */}
      <div className="min-w-0">
      {/* ── Breadcrumb ──────────────────────────────────────── */}
      <div className="mb-7 flex items-center gap-2 text-[12px] text-[#4e535a]">
        <Link
          href="/docs/api-reference"
          className="flex items-center gap-1 hover:text-[#c0c5cc] transition-colors"
        >
          <ChevronLeft size={12} />
          API Reference
        </Link>
        <span>/</span>
        <span className="text-[#8b98a5]">{groupTitle}</span>
        <span>/</span>
        <span className="text-[#c0c5cc] truncate max-w-[200px]">{route.summary}</span>
      </div>

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="mb-8 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#71767b]">
          {groupTitle}
        </p>
        <h1 className="text-[36px] font-bold tracking-tight text-white leading-tight">
          {route.summary}
        </h1>
        <p className="text-[15px] text-[#8b98a5] leading-relaxed">
          {route.description}
        </p>
        {/* X-style method + path + Try it row */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden flex-1 min-w-0 max-w-[640px]">
            <span className={`text-[12px] font-bold font-mono px-3 py-2.5 shrink-0 ${methodBg}`}>
              {route.method}
            </span>
            <code className="text-[13px] font-mono text-[#c0c5cc] px-3 py-2.5 border-l border-white/[0.06] flex-1 min-w-0 truncate">
              {route.path}
            </code>
            <button
              onClick={() => void handleSend()}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold bg-[#1d7a4f] hover:bg-[#1b8f5a] text-[#7ff7be] transition-colors disabled:opacity-50 shrink-0 border-l border-white/[0.06]"
            >
              <Play size={12} className="fill-current" />
              {loading ? "…" : "Try it"}
            </button>
          </div>
          {roleBadge && (
            <span className={`rounded border px-2.5 py-1 text-[10px] font-semibold ${roleBadge.cls}`}>
              {roleBadge.label}
            </span>
          )}
          {route.auth !== "none" && (
            <span className="rounded border border-white/[0.1] px-2.5 py-1 text-[10px] font-mono text-[#4e535a]">
              {route.auth === "credential" ? "CRED" : "JWT"}
            </span>
          )}
        </div>
      </div>

      {/* ── Sections ─────────────────────────────────────────── */}
      <div className="space-y-8">

          {/* Authorizations */}
          {route.auth !== "none" && (
            <section className="space-y-3">
              <SectionDivider title="Authorizations" />
              <div className="rounded-lg border border-white/[0.06] px-4 py-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[13px] font-mono font-semibold text-[#c0c5cc]">
                    Authorization
                  </code>
                  <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] font-mono text-[#71767b]">
                    string
                  </span>
                  <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] font-mono text-[#71767b]">
                    header
                  </span>
                  <span className="rounded border border-red-400/30 bg-red-400/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-400">
                    required
                  </span>
                </div>
                <p className="text-[13px] text-[#71767b] leading-[1.65]">
                  Bearer authentication header of the form{" "}
                  <code className="text-[12px] font-mono bg-white/[0.05] px-1.5 py-0.5 rounded text-[#c0c5cc]">
                    Bearer &lt;token&gt;
                  </code>
                  {" "}where{" "}
                  <code className="text-[12px] font-mono bg-white/[0.05] px-1.5 py-0.5 rounded text-[#c0c5cc]">
                    &lt;token&gt;
                  </code>{" "}
                  is your{" "}
                  {route.auth === "credential" ? "agent credential (snk_agent_…)" : "owner JWT"}.
                </p>
                {/* Token input for Try it */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">
                    Token (for Try it)
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none"
                    placeholder={
                      route.auth === "credential"
                        ? "snk_agent_..."
                        : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    }
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Query Parameters */}
          {queryParams.length > 0 && (
            <section className="space-y-3">
              <SectionDivider title="Query Parameters" />
              <div className="rounded-lg border border-white/[0.06] px-4">
                {queryParams.map((p) => (
                  <ParamBlock
                    key={p.name}
                    param={p}
                    value={paramValues[p.name] ?? ""}
                    onChange={(v) => setParamValues((prev) => ({ ...prev, [p.name]: v }))}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Path Parameters */}
          {pathParams.length > 0 && (
            <section className="space-y-3">
              <SectionDivider title="Path Parameters" />
              <div className="rounded-lg border border-white/[0.06] px-4">
                {pathParams.map((p) => (
                  <ParamBlock
                    key={p.name}
                    param={p}
                    value={paramValues[p.name] ?? ""}
                    onChange={(v) => setParamValues((prev) => ({ ...prev, [p.name]: v }))}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Request Body */}
          {route.bodyExample && (
            <section className="space-y-3">
              <SectionDivider title="Request Body" />
              <textarea
                className="w-full rounded-lg border border-white/[0.08] bg-[#070809] px-4 py-3 font-mono text-[12px] text-[#c0c5cc] focus:border-white/20 focus:outline-none resize-none"
                rows={Math.min(14, bodyText.split("\n").length + 1)}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                spellCheck={false}
              />
            </section>
          )}

          {/* Agent Context */}
          <section className="space-y-3">
            <SectionDivider title="Agent Context" />
            <AgentBox meta={route.agentMeta} />
          </section>

          {/* Error Codes */}
          {route.errors && route.errors.length > 0 && (
            <section className="space-y-3">
              <SectionDivider title="Error Codes" />
              <ErrorTable errors={route.errors} />
            </section>
          )}

          {/* Live response (shown after Try it is clicked) */}
          {liveResponse && (
            <section className="space-y-3">
              <SectionDivider title="Live Response" />
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] bg-[#070809]">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-mono font-semibold ${
                      liveResponse.status >= 200 && liveResponse.status < 300
                        ? "bg-[#7ff7be]/10 text-[#7ff7be]"
                        : "bg-red-400/10 text-red-400"
                    }`}
                  >
                    {liveResponse.status || "Error"}
                  </span>
                  <span className="text-[11px] text-[#4e535a]">Response</span>
                </div>
                <pre className="max-h-72 overflow-auto bg-[#040506] px-4 py-4 text-[11.5px] leading-6 font-mono text-[#9aa4af]">
                  <code>{liveResponse.body}</code>
                </pre>
              </div>
            </section>
          )}
      </div>

      {/* ── Prev / Next navigation ──────────────────────────── */}
      <EndpointNav current={route} />
      </div>

      {/* ── RIGHT sticky panel ─────────────────────────────── */}
      <div className="xl:sticky xl:top-[108px] space-y-4">
        <CurlCard route={route} curl={curl} />
        <ResponseCard route={route} />
        {route.idempotency && (
          <div className="rounded-lg border border-[#f9c74f]/14 bg-[#f9c74f]/[0.03] px-4 py-3 text-[12px] text-[#f9c74f] leading-[1.6]">
            <span className="font-semibold">Idempotent.</span> Pass{" "}
            <code className="font-mono bg-[#f9c74f]/10 px-1 rounded text-[11px]">
              X-Idempotency-Key
            </code>{" "}
            to safely retry without duplicate charges.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Prev / Next ─────────────────────────────────────────────────────────────

function EndpointNav({
  current,
}: {
  current: RouteEndpoint & { groupId: string; groupTitle: string };
}) {
  const idx = ALL_ROUTES.findIndex((r) => r.id === current.id);
  const prev = idx > 0 ? ALL_ROUTES[idx - 1] : null;
  const next = idx < ALL_ROUTES.length - 1 ? ALL_ROUTES[idx + 1] : null;

  if (!prev && !next) return null;

  return (
    <div className="mt-16 flex items-center justify-between border-t border-white/[0.06] pt-8">
      {prev ? (
        <Link
          href={`/docs/api-reference/${prev.id}`}
          className="flex flex-col gap-1 group"
        >
          <span className="text-[11px] uppercase tracking-widest text-[#4e535a] group-hover:text-[#71767b] transition-colors">
            ← Previous
          </span>
          <span className="text-[14px] font-medium text-[#c0c5cc] group-hover:text-white transition-colors">
            {prev.summary}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={`/docs/api-reference/${next.id}`}
          className="flex flex-col gap-1 items-end group"
        >
          <span className="text-[11px] uppercase tracking-widest text-[#4e535a] group-hover:text-[#71767b] transition-colors">
            Next →
          </span>
          <span className="text-[14px] font-medium text-[#c0c5cc] group-hover:text-white transition-colors">
            {next.summary}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}

// ─── Page default export ──────────────────────────────────────────────────────

export default function EndpointPage({ params }: { params: { id: string } }) {
  const route = ALL_ROUTES.find((r) => r.id === params.id);

  if (!route) {
    return (
      <div className="py-16 text-center space-y-4">
        <p className="text-[#4e535a] text-[14px]">Endpoint not found.</p>
        <Link
          href="/docs/api-reference"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#7ff7be] hover:opacity-80 transition-opacity"
        >
          <ChevronLeft size={13} />
          Back to API Reference
        </Link>
      </div>
    );
  }

  return <EndpointDetail route={route} groupTitle={route.groupTitle} />;
}
