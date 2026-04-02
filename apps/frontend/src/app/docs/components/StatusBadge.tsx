export function StatusBadge({ status }: Readonly<{ status: string }>) {
  if (status === "GA")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase border border-[#7ff7be]/25 bg-[#7ff7be]/10 text-[#7ff7be]">
        GA
      </span>
    );
  if (status === "BETA")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase border border-[#6eb6f6]/25 bg-[#6eb6f6]/10 text-[#6eb6f6]">
        BETA
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-widest uppercase border border-white/10 bg-white/5 text-[#9a9fa6]">
      SOON
    </span>
  );
}
