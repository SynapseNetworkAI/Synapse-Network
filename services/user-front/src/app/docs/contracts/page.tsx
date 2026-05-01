"use client";

import { GitBranch, FileText, ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { StatusBadge } from "../components/StatusBadge";
import { useActiveSection } from "../use-active-section";
import { useDocsPageNav } from "../use-docs-page-nav";

const PAGE_SECTIONS = ["contract-core", "contract-usdc", "contract-abi"];

// ── Public contract addresses ────────────────────────────────────────────────
// Prod addresses will be filled in after production deployment.
// Public docs intentionally expose staging first; internal local deployments stay in ops docs.
type AppEnv = "staging" | "prod";

interface EnvDef {
  label: string;
  chainName: string;
  chainId: string;
  color: string;
  explorer: string | null; // base URL, null = no public explorer
  contracts: {
    SynapseCore: string | null; // null = not yet deployed
    MockUSDC: string | null;
  };
}

const ENVS: Record<AppEnv, EnvDef> = {
  staging: {
    label: "Staging",
    chainName: "Arbitrum Sepolia",
    chainId: "421614",
    color: "#6eb6f6",
    explorer: "https://sepolia.arbiscan.io",
    contracts: {
      SynapseCore: "0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4",
      MockUSDC: "0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9",
    },
  },
  prod: {
    label: "Production",
    chainName: "Arbitrum One",
    chainId: "42161",
    color: "#f9c74f",
    explorer: "https://arbiscan.io",
    contracts: {
      SynapseCore: null, // fill after mainnet deployment
      MockUSDC: null,
    },
  },
};

const GITHUB_CONTRACTS =
  "https://github.com/SynapseNetworkAI/Synapse-Network/tree/main/contracts";

function explorerAddressUrl(explorer: string, address: string) {
  return `${explorer}/address/${address}`;
}

function AddressRow({
  envDef,
  address,
  accentColor,
  isCurrent,
  currentLabel,
  localHint,
  notDeployedLabel,
}: Readonly<{
  envDef: EnvDef;
  address: string | null;
  accentColor: string;
  isCurrent: boolean;
  currentLabel: string;
  localHint: string;
  notDeployedLabel: string;
}>) {
  return (
    <div
      className="rounded-2xl p-4 space-y-2.5 transition-colors"
      style={{
        background: isCurrent ? `${accentColor}0d` : "rgba(255,255,255,0.02)",
        border: `1px solid ${
          isCurrent ? accentColor + "30" : "rgba(255,255,255,0.05)"
        }`,
      }}
    >
      {/* Network label row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: accentColor }}
          />
          <span
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: accentColor }}
          >
            {envDef.label}
          </span>
          <span className="text-[11px] text-[#4e535a] font-mono">
            {envDef.chainName}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono border border-white/[0.06] text-[#4e535a]">
            chainId: {envDef.chainId}
          </span>
        </div>
        {isCurrent && (
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: `${accentColor}20`, color: accentColor }}
          >
            {currentLabel}
          </span>
        )}
      </div>

      {/* Address */}
      {address ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <code
            className="text-[12.5px] font-mono break-all"
            style={{ color: accentColor }}
          >
            {address}
          </code>
          {envDef.explorer ? (
            <a
              href={explorerAddressUrl(envDef.explorer, address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 shrink-0 text-[12px] text-[#71767b] hover:text-white transition-colors"
            >
              <ExternalLink size={12} />
              {envDef.label === "Staging" ? "Arbiscan Sepolia" : "Arbiscan"}
            </a>
          ) : (
            <span className="text-[11px] text-[#4e535a]">{localHint}</span>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-[#4e535a] italic">{notDeployedLabel}</p>
      )}
    </div>
  );
}

export default function ContractsPage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "contract-core");
  useDocsPageNav([
    { id: "contract-core", label: t("docsPage.contractsCoreTitle") },
    { id: "contract-usdc", label: t("docsPage.contractsMockTitle") },
    { id: "contract-abi", label: t("docsPage.contractsAbiTitle") },
  ]);

  const rawEnv = process.env.NEXT_PUBLIC_APP_ENV;
  let currentEnv: AppEnv = "staging";
  if (rawEnv === "prod") currentEnv = "prod";

  return (
    <div className="space-y-16">
      <ContractsHeader currentEnv={currentEnv} t={t} />
      <SynapseCoreSection currentEnv={currentEnv} t={t} />
      <MockUsdcSection currentEnv={currentEnv} t={t} />
      <AbiSourceSection t={t} tList={tList} />
      <div className="h-16" />
    </div>
  );
}

type TranslationFn = (key: string) => string;
type TranslationListFn = (key: string) => string[];

function ContractsHeader({
  currentEnv,
  t,
}: Readonly<{ currentEnv: AppEnv; t: TranslationFn }>) {
  return (
    <div className="space-y-2 border-b border-white/[0.06] pb-8">
      <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
        {t("docsPage.contractsEyebrow")}
      </span>
      <h1 className="x-page-title text-white">
        {t("docsPage.contractsTitle")}
      </h1>
      <p className="x-body-copy max-w-[560px]">
        {t("docsPage.contractsDescription")}
      </p>
      <div
        className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-lg text-[12px] font-mono border"
        style={{
          borderColor: `${ENVS[currentEnv].color}30`,
          background: `${ENVS[currentEnv].color}0d`,
          color: ENVS[currentEnv].color,
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: ENVS[currentEnv].color }}
        />
        {t("docsPage.contractsCurrentEnv")}：{ENVS[currentEnv].label} —{" "}
        {ENVS[currentEnv].chainName}
      </div>
    </div>
  );
}

function ContractAddressList({
  currentEnv,
  contractName,
  t,
}: Readonly<{
  currentEnv: AppEnv;
  contractName: keyof EnvDef["contracts"];
  t: TranslationFn;
}>) {
  return (
    <div className="space-y-3">
      {(Object.keys(ENVS) as AppEnv[]).map((env) => (
        <AddressRow
          key={env}
          envDef={ENVS[env]}
          address={ENVS[env].contracts[contractName]}
          accentColor={ENVS[env].color}
          isCurrent={env === currentEnv}
          currentLabel={t("docsPage.contractsCurrentEnvTag")}
          localHint={t("docsPage.contractsLocalExplorerHint")}
          notDeployedLabel={t("docsPage.contractsNotDeployed")}
        />
      ))}
    </div>
  );
}

function SourceCodeNote({ t }: Readonly<{ t: TranslationFn }>) {
  return (
    <div className="x-panel-muted rounded-xl p-4 flex gap-3">
      <span className="shrink-0 mt-0.5">💡</span>
      <p className="text-[13px] text-[#71767b] leading-relaxed">
        {t("docsPage.contractsSourceTip")}{" "}
        <a
          href={GITHUB_CONTRACTS}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#7ff7be] hover:underline inline-flex items-center gap-1"
        >
          {t("docsPage.contractsGithubSource")} <ExternalLink size={11} />
        </a>
      </p>
    </div>
  );
}

const CORE_FUNCTION_ROWS = [
  { fn: "deposit(uint256 amount)", desc: "锁入 USDC，触发 Deposited 事件" },
  {
    fn: "withdraw(address to, uint256 amount)",
    desc: "向 Provider 钱包转账 USDC（仅 Gateway 可用）",
  },
  { fn: "getBalance(address user)", desc: "查询用户在合约内的存款余额" },
];

const CORE_EVENT_ROWS = [
  {
    ev: "Deposited(address user, uint256 amount)",
    fields: "充值确认，Gateway 监听此事件",
  },
  {
    ev: "Withdrawn(address to, uint256 amount)",
    fields: "提现执行，链上转账完成",
  },
];

function DataTable({
  columns,
  rows,
  accentClass,
}: Readonly<{
  columns: readonly [string, string];
  rows: readonly { key: string; value: string }[];
  accentClass?: string;
}>) {
  return (
    <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            {columns.map((column) => (
              <th
                key={column}
                className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 first:table-cell last:hidden last:md:table-cell"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              <td className="px-4 py-3">
                <code
                  className={`text-[12px] font-mono ${
                    accentClass ?? "text-[#c0c5cc]"
                  }`}
                >
                  {row.key}
                </code>
              </td>
              <td className="px-4 py-3 hidden md:table-cell">
                <span className="text-[12px] text-[#71767b]">{row.value}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SynapseCoreSection({
  currentEnv,
  t,
}: Readonly<{ currentEnv: AppEnv; t: TranslationFn }>) {
  return (
    <section id="contract-core" className="space-y-6">
      <div className="flex items-center gap-3">
        <GitBranch size={18} className="text-[#7ff7be]" />
        <h2 className="x-section-title text-white">
          {t("docsPage.contractsCoreTitle")}
        </h2>
        <StatusBadge status="GA" />
      </div>
      <p className="x-body-copy">
        {t("docsPage.contractsCoreDescription")}
        {ENVS[currentEnv].explorer && (
          <span className="ml-1">{t("docsPage.contractsCoreVerified")}</span>
        )}
      </p>
      <ContractAddressList
        currentEnv={currentEnv}
        contractName="SynapseCore"
        t={t}
      />
      <SourceCodeNote t={t} />
      <h3 className="text-[15px] font-semibold text-white">
        {t("docsPage.contractsKeyFunctions")}
      </h3>
      <DataTable
        columns={["Function", "Description"]}
        rows={CORE_FUNCTION_ROWS.map((row) => ({
          key: row.fn,
          value: row.desc,
        }))}
      />
      <h3 className="text-[15px] font-semibold text-white mt-6">Events</h3>
      <DataTable
        columns={["Event", "Fields"]}
        rows={CORE_EVENT_ROWS.map((row) => ({
          key: row.ev,
          value: row.fields,
        }))}
        accentClass="text-[#7ff7be]"
      />
    </section>
  );
}

const MOCK_USDC_FACTS = [
  { title: "Symbol", value: "USDC (Mock)" },
  { title: "Decimals", value: "18 (testnet) / 6 (mainnet)" },
  { title: "Mint", value: "Owner only — staging pre-mint" },
  { title: "Burn", value: "Owner only" },
];

function MockUsdcSection({
  currentEnv,
  t,
}: Readonly<{ currentEnv: AppEnv; t: TranslationFn }>) {
  return (
    <section id="contract-usdc" className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText size={18} className="text-[#6eb6f6]" />
        <h2 className="x-section-title text-white">MockUSDC</h2>
        <StatusBadge status="BETA" />
      </div>
      <p className="x-body-copy">
        测试用 ERC-20 Token，18 decimals，staging 使用 owner-only{" "}
        <code className="text-[#c0c5cc] font-mono text-[12px]">mint()</code>{" "}
        和部署时预铸币。生产环境使用 Circle 官方 USDC（6 decimals）。
      </p>
      <ContractAddressList
        currentEnv={currentEnv}
        contractName="MockUSDC"
        t={t}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MOCK_USDC_FACTS.map((row) => (
          <div
            key={row.title}
            className="x-panel-muted rounded-xl px-4 py-3 flex items-center justify-between"
          >
            <span className="text-[12px] text-[#4e535a]">{row.title}</span>
            <span className="text-[13px] font-mono text-[#c0c5cc]">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <div className="x-panel-muted rounded-xl p-4 flex gap-3">
        <span className="text-yellow-400 mt-0.5 shrink-0">⚠️</span>
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          MockUSDC 仅用于开发测试。Prod 环境使用真实 USDC， 注意切换
          decimals（6）并更新合约地址。
        </p>
      </div>
    </section>
  );
}

function AbiSourceSection({
  t,
  tList,
}: Readonly<{ t: TranslationFn; tList: TranslationListFn }>) {
  const abiLinks = tList("docsPage.contractsAbiLinks");
  const links = [
    {
      href: GITHUB_CONTRACTS,
      label: abiLinks[0] ?? "GitHub — contracts/",
      className: "text-[#7ff7be]",
    },
    {
      href: "https://sepolia.arbiscan.io",
      label: abiLinks[1] ?? "Arbiscan Sepolia (Staging)",
      className: "text-[#6eb6f6]",
    },
    {
      href: "https://arbiscan.io",
      label: abiLinks[2] ?? "Arbiscan (Production)",
      className: "text-[#f9c74f]",
    },
  ];

  return (
    <section
      id="contract-abi"
      className="space-y-4 border-t border-white/[0.06] pt-10"
    >
      <h3 className="x-card-title text-white">
        {t("docsPage.contractsAbiTitle")}
      </h3>
      <p className="x-body-copy">{t("docsPage.contractsAbiDescription")}</p>
      <div className="flex gap-4 flex-wrap">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-[13px] hover:underline ${link.className}`}
          >
            <ExternalLink size={13} /> {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
