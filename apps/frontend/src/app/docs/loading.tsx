/**
 * Docs route loading skeleton — shown by Next.js App Router while the target
 * docs page JS chunk downloads and hydrates. Sidebar + top-nav stay visible
 * (they live in layout.tsx); only this replaces <main> content.
 */
export default function DocsLoading() {
  return (
    <div className="animate-pulse space-y-14" aria-hidden="true">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8">
        <div className="h-2.5 w-14 rounded-full bg-white/[0.06]" />
        <div className="flex items-center gap-3">
          <div className="h-7 w-56 rounded-full bg-white/[0.09]" />
          <div className="h-5 w-12 rounded-full bg-white/[0.05]" />
        </div>
        <div className="h-3.5 w-[min(400px,80%)] rounded-full bg-white/[0.04]" />
        <div className="h-3.5 w-[min(320px,64%)] rounded-full bg-white/[0.03]" />
      </div>

      {/* ── First section ───────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="h-5 w-44 rounded-full bg-white/[0.07]" />
        <div className="space-y-2.5">
          <div className="h-3.5 w-full rounded-full bg-white/[0.04]" />
          <div className="h-3.5 w-11/12 rounded-full bg-white/[0.04]" />
          <div className="h-3.5 w-4/5 rounded-full bg-white/[0.04]" />
        </div>

        {/* Code block skeleton */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/[0.05]">
            <div className="h-2.5 w-10 rounded-full bg-white/[0.07]" />
          </div>
          <div className="p-4 space-y-2">
            <div className="h-3 w-[72%] rounded-full bg-white/[0.05]" />
            <div className="h-3 w-[55%] rounded-full bg-white/[0.05]" />
            <div className="h-3 w-[68%] rounded-full bg-white/[0.05]" />
            <div className="h-3 w-[40%] rounded-full bg-white/[0.04]" />
          </div>
        </div>
      </div>

      {/* ── Card grid skeleton ──────────────────────────────────── */}
      <div className="space-y-5">
        <div className="h-5 w-36 rounded-full bg-white/[0.07]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 space-y-3"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="h-3 w-16 rounded-full bg-white/[0.08]" />
              <div className="h-5 w-32 rounded-full bg-white/[0.06]" />
              <div className="h-3 w-full rounded-full bg-white/[0.04]" />
              <div className="h-3 w-4/5 rounded-full bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>

      {/* ── Second section ──────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="h-5 w-52 rounded-full bg-white/[0.07]" />
        <div className="space-y-2.5">
          <div className="h-3.5 w-full rounded-full bg-white/[0.04]" />
          <div className="h-3.5 w-10/12 rounded-full bg-white/[0.04]" />
        </div>
        {/* Table skeleton */}
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex gap-8">
              <div className="h-2.5 w-14 rounded-full bg-white/[0.08]" />
              <div className="h-2.5 w-16 rounded-full bg-white/[0.08]" />
              <div className="h-2.5 w-24 rounded-full bg-white/[0.08]" />
            </div>
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 border-b border-white/[0.04] last:border-0 flex gap-8">
              <div className="h-3 w-32 rounded-full bg-white/[0.05]" />
              <div className="h-3 w-20 rounded-full bg-white/[0.04]" />
              <div className="h-3 w-48 rounded-full bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
