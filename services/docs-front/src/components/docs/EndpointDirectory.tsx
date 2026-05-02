import apiReference from "@/data/api-reference.json";
import Link from "next/link";

const roleLabel: Record<string, string> = {
  owner: "Owner",
  consumer_agent: "Consumer Agent",
  provider: "Provider",
  public: "Public",
};

export function EndpointDirectory() {
  return (
    <div className="not-prose my-8 space-y-7">
      {apiReference.groups.map((group) => (
        <section key={group.id} id={group.id} className="scroll-mt-24">
          <div className="mb-3 flex flex-col gap-1 border-b border-white/10 pb-3">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-fd-foreground">
              {group.title}
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-fd-muted-foreground">
              {group.description}
            </p>
          </div>
          <div className="divide-y divide-white/[0.07] overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#050708]">
            {group.routes.map((route) => (
              <Link
                key={route.id}
                href={`/api-reference/${route.id}`}
                className="grid gap-3 px-4 py-4 transition hover:bg-white/[0.035] md:grid-cols-[92px_minmax(0,1fr)_160px]"
              >
                <span className="font-mono text-xs font-semibold text-[#7ff7be]">
                  {route.method}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fd-foreground">
                    {route.summary}
                  </span>
                  <span className="mt-1 block truncate font-mono text-xs text-fd-muted-foreground">
                    {route.path}
                  </span>
                </span>
                <span className="text-xs text-fd-muted-foreground md:text-right">
                  {roleLabel[route.agentMeta.role] ?? route.agentMeta.role}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
