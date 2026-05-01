import {
  ArrowRight,
  Boxes,
  Coffee,
  ExternalLink,
  FileCode2,
  Hash,
  Terminal,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { SDK_GITHUB_ROOT } from "./sdkSnippetExamples";

type SdkCard = {
  id: string;
  title: string;
  description: string;
  chips: string[];
  href: string;
  accent: string;
  icon: typeof FileCode2;
  external: boolean;
  size: "large" | "compact";
};

const CARD_TITLES = [
  "TypeScript SDK",
  "Python SDK",
  "Go SDK",
  "Java/JVM SDK",
  ".NET SDK",
];
const CARD_DESCRIPTIONS = [
  "Browser, Node.js, Next.js, and serverless runtime support.",
  "Backend automation and Python 3.13+ agent workflows.",
  "Go client for agent, owner, and provider flows.",
  "Java 17+ client for JVM systems and provider tooling.",
  "net8.0 client for C# services and provider tooling.",
];
const CARD_CHIPS = [
  "Owner auth|Provider publishing|Runtime invoke",
  "Wallet auth|Credential issue|Runtime invoke",
  "Owner auth|Provider publishing|Runtime invoke",
  "Owner auth|Provider publishing|Runtime invoke",
  "Owner auth|Provider publishing|Runtime invoke",
];

export function buildSdkCards(): SdkCard[] {
  return [
    card(
      "typescript",
      CARD_TITLES[0],
      CARD_DESCRIPTIONS[0],
      CARD_CHIPS[0],
      "/docs/sdk/typescript",
      "#6eb6f6",
      FileCode2,
      false,
      "large"
    ),
    card(
      "python",
      CARD_TITLES[1],
      CARD_DESCRIPTIONS[1],
      CARD_CHIPS[1],
      "/docs/sdk/python",
      "#7ff7be",
      Boxes,
      false,
      "large"
    ),
    card(
      "go",
      CARD_TITLES[2],
      CARD_DESCRIPTIONS[2],
      CARD_CHIPS[2],
      `${SDK_GITHUB_ROOT}/docs/sdk/go_integration.md`,
      "#6eb6f6",
      Terminal,
      true,
      "compact"
    ),
    card(
      "java",
      CARD_TITLES[3],
      CARD_DESCRIPTIONS[3],
      CARD_CHIPS[3],
      `${SDK_GITHUB_ROOT}/docs/sdk/java_integration.md`,
      "#f7c86e",
      Coffee,
      true,
      "compact"
    ),
    card(
      "dotnet",
      CARD_TITLES[4],
      CARD_DESCRIPTIONS[4],
      CARD_CHIPS[4],
      `${SDK_GITHUB_ROOT}/docs/sdk/dotnet_integration.md`,
      "#b58cff",
      Hash,
      true,
      "compact"
    ),
  ];
}

export function SdkCardSection({
  id,
  title,
  description,
  cards,
  capabilityLabel,
  ctaLabel,
  columns,
  framed = false,
  onOpen,
}: Readonly<{
  id: string;
  title: string;
  description: string;
  cards: SdkCard[];
  capabilityLabel: string;
  ctaLabel: string;
  columns: string;
  framed?: boolean;
  onOpen?: (href: string) => void;
}>) {
  return (
    <section
      id={id}
      className={
        framed
          ? "space-y-4 rounded-3xl border border-white/[0.06] bg-[radial-gradient(circle_at_top_right,rgba(110,182,246,0.10),transparent_34%),#070809] p-5"
          : "space-y-5"
      }
    >
      <div>
        <h2 className="x-section-title text-white">{title}</h2>
        <p className="mt-2 max-w-[720px] text-[14px] leading-6 text-[#8b98a5]">
          {description}
        </p>
      </div>
      <div className={`grid grid-cols-1 gap-3 ${columns}`}>
        {cards.map((sdkCard) => (
          <SdkCardView
            key={sdkCard.id}
            card={sdkCard}
            capabilityLabel={capabilityLabel}
            ctaLabel={ctaLabel}
            onOpen={sdkCard.external ? undefined : () => onOpen?.(sdkCard.href)}
          />
        ))}
      </div>
    </section>
  );
}

function card(
  id: string,
  title: string,
  description: string,
  chips: string | undefined,
  href: string,
  accent: string,
  icon: typeof FileCode2,
  external: boolean,
  size: "large" | "compact"
): SdkCard {
  return {
    id,
    title,
    description,
    chips: splitChips(chips),
    href,
    accent,
    icon,
    external,
    size,
  };
}

function SdkCardView({
  card: sdkCard,
  capabilityLabel,
  ctaLabel,
  onOpen,
}: Readonly<{
  card: SdkCard;
  capabilityLabel: string;
  ctaLabel: string;
  onOpen?: () => void;
}>) {
  const className =
    sdkCard.size === "large"
      ? "x-tile-flat x-tile-flat-hover rounded-2xl p-6 text-left"
      : "rounded-2xl border border-white/[0.07] bg-[#0a0b0d]/85 p-5 text-left transition hover:border-white/20 hover:bg-white/[0.035]";
  const content = (
    <>
      <CardHeader card={sdkCard} />
      <h3
        className={
          sdkCard.size === "large"
            ? "x-section-title text-white"
            : "text-[18px] font-semibold text-white"
        }
      >
        {sdkCard.title}
      </h3>
      <p
        className={
          sdkCard.size === "large"
            ? "mt-2 text-[14px] leading-7 text-[#8b98a5]"
            : "mt-2 text-[13px] leading-6 text-[#8b98a5]"
        }
      >
        {sdkCard.description}
      </p>
      <CapabilityChips label={capabilityLabel} chips={sdkCard.chips} />
      <div
        className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold"
        style={{ color: sdkCard.accent }}
      >
        {ctaLabel}
        {sdkCard.external ? (
          <ExternalLink size={14} aria-hidden="true" />
        ) : (
          <ArrowRight size={14} />
        )}
      </div>
    </>
  );

  if (sdkCard.external) {
    return (
      <a
        href={sdkCard.href}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  );
}

function CardHeader({ card: sdkCard }: Readonly<{ card: SdkCard }>) {
  return (
    <div
      className={
        sdkCard.size === "large"
          ? "mb-5 flex items-start justify-between gap-3"
          : "mb-4 flex items-start justify-between gap-3"
      }
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-xl border"
        style={{
          borderColor: `${sdkCard.accent}2f`,
          background: `${sdkCard.accent}14`,
        }}
      >
        <sdkCard.icon size={18} style={{ color: sdkCard.accent }} />
      </div>
      {sdkCard.size === "large" ? <StatusBadge status="PREVIEW" /> : null}
    </div>
  );
}

function CapabilityChips({
  label,
  chips,
}: Readonly<{ label: string; chips: string[] }>) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" aria-label={label}>
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-[#c8d0d8]"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function splitChips(value: string | undefined) {
  return (value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}
