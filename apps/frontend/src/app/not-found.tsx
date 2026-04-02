import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative flex min-h-[calc(100vh-60px)] flex-col items-center justify-center overflow-hidden px-6 py-16">
      {/* Ambient glow — mirrors globals.css body radial */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div
          className="absolute left-1/2 top-[-10%] h-[680px] w-[1000px] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(ellipse, rgba(47,255,161,0.07) 0%, transparent 68%)",
            filter: "blur(48px)",
          }}
        />
        <div
          className="absolute right-[-8%] top-[20%] h-[400px] w-[400px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(29,155,240,0.05) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
      </div>

      {/* Status chip */}
      <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-[#2fffa1]" />
        <span className="x-overline-label tracking-widest uppercase text-[#71767b]">
          Synapse Network
        </span>
      </div>

      {/* 404 numeral */}
      <div className="relative mb-6 select-none" aria-hidden="true">
        <span
          className="block font-mono text-[9rem] leading-none font-black tracking-[-0.06em] tabular-nums sm:text-[11rem]"
          style={{
            background:
              "linear-gradient(135deg, #2fffa1 0%, #1d9bf0 55%, #e0eeff 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 0 48px rgba(47,255,161,0.12))",
          }}
        >
          404
        </span>
      </div>

      {/* Headline */}
      <h1 className="x-page-title mb-3 text-center text-[#f5f5f7]">
        Page not found
      </h1>

      {/* Body */}
      <p className="x-body-copy mb-10 max-w-[22rem] text-center">
        This route doesn&apos;t exist in the network. Check the URL or navigate back
        to a known endpoint.
      </p>

      {/* CTAs */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/dashboard/overview"
          className="x-action-label x-button-primary inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold"
        >
          Open Dashboard
        </Link>
        <Link
          href="/"
          className="x-action-label x-button-ghost inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold"
        >
          Go Home
        </Link>
      </div>

      {/* Bottom divider + meta */}
      <div className="absolute bottom-8 flex flex-col items-center gap-1">
        <div className="h-px w-16 bg-white/[0.06]" />
        <span className="x-meta-label mt-2 text-[#71767b]">
          M2M Settlement Infrastructure
        </span>
      </div>
    </div>
  );
}
