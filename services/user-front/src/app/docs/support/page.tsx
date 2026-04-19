import Link from "next/link";
import { Bug, CreditCard, FileText, Github, MessageSquare, RadioTower } from "lucide-react";
import SupportContactPanel from "@/components/shared/SupportContactPanel";

const supportCards = [
  {
    title: "Developer Forum",
    description: "Ask questions, discuss SDK integration, and share provider services with other builders.",
    href: "/forum",
    icon: MessageSquare,
  },
  {
    title: "Billing Support",
    description: "Need help with credits, withdrawals, refunds, or reconciliation? Send a billing-scoped report.",
    href: "/dashboard/billing/credits",
    icon: CreditCard,
  },
  {
    title: "Bug Report",
    description: "Report product bugs with route, wallet context, and correlation details attached.",
    href: "/dashboard/discovery",
    icon: Bug,
  },
  {
    title: "Docs Issue",
    description: "Use the feedback widget at the bottom of any docs page to flag incorrect or missing guidance.",
    href: "/docs#introduction",
    icon: FileText,
  },
  {
    title: "GitHub",
    description: "Open SDK issues, inspect examples, or link code-level reproductions.",
    href: "https://github.com/cliff-personal/Synapse-Network-Sdk",
    icon: Github,
    external: true,
  },
  {
    title: "Status",
    description: "Status page is planned; for v1, use gateway readiness and support escalation.",
    href: "#",
    icon: RadioTower,
    soon: true,
  },
];

export default function DocsSupportPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#7ff7be]">Support</p>
        <h1 className="text-4xl font-semibold tracking-[-0.045em] text-[#e7e9ea] md:text-5xl">
          Developer Support
        </h1>
        <p className="max-w-3xl text-[17px] leading-8 text-[#8b98a5]">
          A signal loop for Synapse builders: report docs issues in context, file product bugs from the console,
          and use the forum for community questions and provider integration discussions.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {supportCards.map((card) => {
          const Icon = card.icon;
          const content = (
            <div className="group h-full rounded-[28px] border border-[#1f2328] bg-[#050505] p-5 transition hover:border-[#2f3336] hover:bg-[#080a0c]">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#7ff7be]/20 bg-[#7ff7be]/10 text-[#7ff7be]">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-[#e7e9ea]">{card.title}</h2>
                    {card.soon ? (
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                        Soon
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#8b98a5]">{card.description}</p>
                </div>
              </div>
            </div>
          );
          if (card.soon) return <div key={card.title}>{content}</div>;
          return (
            <Link
              key={card.title}
              href={card.href}
              target={card.external ? "_blank" : undefined}
              rel={card.external ? "noopener noreferrer" : undefined}
            >
              {content}
            </Link>
          );
        })}
      </section>

      <SupportContactPanel
        title="Support fallback"
        description="If the feedback API is unavailable, use the configured support portal or email. Include the route, wallet short address, and any feedback id you already received."
        actionLabel="Contact support"
      />
    </article>
  );
}
