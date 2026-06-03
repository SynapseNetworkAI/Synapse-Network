import { environmentConfig } from "@/lib/shared";

function isContractAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isInternalConfigPath(value: string) {
  return value.includes("/") && !isUrl(value) && !isContractAddress(value);
}

function isReservedValue(value: string) {
  return value.toLowerCase().startsWith("reserved until");
}

function publicAddressLabel(value: string) {
  if (isReservedValue(value)) {
    return "Not published";
  }
  if (isInternalConfigPath(value)) {
    return "Configured locally";
  }
  return value;
}

function ExplorerAddressLink({
  address,
  explorerUrl,
}: Readonly<{ address: string; explorerUrl: string }>) {
  const publicLabel = publicAddressLabel(address);
  if (!isContractAddress(address)) {
    return <span>{publicLabel}</span>;
  }

  return (
    <a
      className="text-[#7ff7be] underline-offset-4 hover:underline"
      href={`${explorerUrl}/address/${address}`}
      rel="noreferrer"
      target="_blank"
    >
      {address}
    </a>
  );
}

function EnvironmentValue({ value }: Readonly<{ value: string }>) {
  if (isUrl(value)) {
    return (
      <a
        className="text-[#7ff7be] underline-offset-4 hover:underline"
        href={value}
        rel="noreferrer"
        target="_blank"
      >
        {value}
      </a>
    );
  }

  return <span>{publicAddressLabel(value)}</span>;
}

function CodePanel({ children }: Readonly<{ children: string }>) {
  return (
    <pre className="my-4 overflow-auto rounded-[10px] border border-white/[0.08] bg-[#050708] p-4 text-[12px] leading-6 text-[#d6fbe7]">
      <code>{children}</code>
    </pre>
  );
}

export function EnvironmentConfigSummary() {
  const rows = [
    ["Environment", environmentConfig.appEnv],
    ["Gateway Base", environmentConfig.gatewayBaseUrl],
    ["Docs", environmentConfig.docsUrl],
    ["Chain", `${environmentConfig.chainName} (${environmentConfig.chainId})`],
    ["Explorer", environmentConfig.explorerUrl],
  ];

  return (
    <div className="not-prose my-6 rounded-[12px] border border-[#7ff7be]/20 bg-[#7ff7be]/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-fd-foreground">
          Current environment addresses
        </p>
        <span className="rounded-full border border-[#7ff7be]/25 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#7ff7be]">
          {environmentConfig.appEnv}
        </span>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fd-muted-foreground">
              {label}
            </dt>
            <dd className="break-all font-mono text-xs text-fd-foreground">
              <EnvironmentValue value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function GatewayEnvExport() {
  return (
    <CodePanel>{`export SYNAPSE_ENV="${environmentConfig.appEnv}"
export GATEWAY_URL="${environmentConfig.gatewayBaseUrl}"`}</CodePanel>
  );
}

export function McpEnvironmentExample() {
  return (
    <CodePanel>{`SYNAPSE_AGENT_KEY=agt_xxx
SYNAPSE_ENV=${environmentConfig.appEnv}
SYNAPSE_GATEWAY_URL=${environmentConfig.gatewayBaseUrl}
SYNAPSE_TIMEOUT_MS=30000`}</CodePanel>
  );
}

export function EnvironmentNetworksTable() {
  const row = environmentConfig;

  return (
    <div className="not-prose my-6 rounded-[12px] border border-white/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.04] px-4 py-3">
        <p className="text-sm font-semibold text-fd-foreground">
          Contract target for this docs environment
        </p>
        <span className="rounded-full border border-[#7ff7be]/25 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#7ff7be]">
          {row.appEnv}
        </span>
      </div>
      <dl className="grid gap-px overflow-hidden rounded-b-[12px] bg-white/[0.08] md:grid-cols-2">
        {[
          ["Environment", row.appEnv],
          ["Chain", row.chainName],
          ["Chain ID", row.chainId],
          ["Asset", row.asset],
          ["SynapseCore", row.synapseCore],
          ["Token", row.token],
          ["Explorer", row.explorerUrl],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#050708] px-4 py-3">
            <dt className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fd-muted-foreground">
              {label}
            </dt>
            <dd className="break-all font-mono text-xs text-fd-foreground">
              {label === "SynapseCore" || label === "Token" ? (
                <ExplorerAddressLink
                  address={value}
                  explorerUrl={row.explorerUrl}
                />
              ) : (
                <EnvironmentValue value={value} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
