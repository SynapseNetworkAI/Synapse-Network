import { environmentConfig, environmentRows } from "@/lib/shared";

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
  return (
    <div className="not-prose my-6 overflow-auto rounded-[12px] border border-white/[0.08]">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-fd-muted-foreground">
          <tr>
            {[
              "Environment",
              "Chain",
              "Chain ID",
              "Asset",
              "SynapseCore",
              "Token",
              "Explorer",
            ].map((header) => (
              <th key={header} className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {environmentRows.map((row) => (
            <tr
              key={row.appEnv}
              className="border-t border-white/[0.08] align-top"
            >
              <td className="px-4 py-3 font-semibold capitalize">
                {row.appEnv}
              </td>
              <td className="px-4 py-3">{row.chainName}</td>
              <td className="px-4 py-3 font-mono">{row.chainId}</td>
              <td className="px-4 py-3">{row.asset}</td>
              <td className="break-all px-4 py-3 font-mono text-xs">
                <ExplorerAddressLink
                  address={row.synapseCore}
                  explorerUrl={row.explorerUrl}
                />
              </td>
              <td className="break-all px-4 py-3 font-mono text-xs">
                <ExplorerAddressLink
                  address={row.token}
                  explorerUrl={row.explorerUrl}
                />
              </td>
              <td className="break-all px-4 py-3 font-mono text-xs">
                <a
                  className="text-[#7ff7be] underline-offset-4 hover:underline"
                  href={row.explorerUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {row.explorerUrl}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
