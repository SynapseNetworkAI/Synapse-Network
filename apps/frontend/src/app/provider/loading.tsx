export default function ProviderRouteLoading() {
  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <div className="h-8 w-64 animate-pulse rounded bg-[#181818]" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-[#111111]" />
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-4">
        <div className="h-10 w-full animate-pulse rounded-lg bg-[#111111]" />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-2xl border border-[#222222] bg-[#0a0a0a]" />
        <div className="h-64 animate-pulse rounded-2xl border border-[#222222] bg-[#0a0a0a]" />
      </div>
    </div>
  );
}
