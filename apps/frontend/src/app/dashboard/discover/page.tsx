export { default } from "@/components/dashboard/discovery/DiscoveryConsolePage";
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Service shortlist for the current task.</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                <Activity className="h-3.5 w-3.5" />
                {polling ? "Refreshing health" : `Refresh ${AUTO_POLL_MS / 1000}s`}
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-[1.4rem] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="mt-6 space-y-4">
              {candidateState || (
                services.map((service, index) => {
                  const statusMeta = resolveStatusMeta(service);
                  const isSelected = selectedServiceId === service.serviceId;

                  return (
                    <button
                      key={service.id || service.serviceId}
                      type="button"
                      onClick={() => setSelectedServiceId(service.serviceId)}
                      className={`w-full rounded-[1.5rem] border px-5 py-5 text-left transition ${isSelected ? "border-emerald-400/30 bg-emerald-400/6" : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"}`}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-2 text-[11px] font-semibold text-white/60">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusMeta.border} ${statusMeta.badge} ${statusMeta.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                              {statusMeta.label}
                            </span>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                              {resolveHealthSummary(service)}
                            </span>
                          </div>
                          <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">
                            {resolveServiceTitle(service)}
                          </h3>
                          <p className="mt-1 font-mono text-[12px] text-zinc-500">{service.serviceId}</p>
                          <p className="mt-4 text-sm leading-7 text-zinc-400">
                            {service.summary?.trim() || "Manifest summary unavailable. Use the preview rail to inspect schemas, auth, and runtime constraints."}
                          </p>
                          {service.tags && service.tags.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {service.tags.slice(0, 5).map((tag) => (
                                <span key={`${service.serviceId}-${tag}`} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
                          <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                            {formatPricing(service.pricing)}
                          </span>
                          <span className="text-xs text-zinc-500">{resolveConstraintLabel(service)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <aside className="rounded-[1.8rem] border border-white/10 bg-[#090909] p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Manifest preview</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Inspect runtime contract before invoking.</h2>
            </div>

            {hasSelectedService ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold tracking-tight text-white">{resolveServiceTitle(selectedService)}</h3>
                      <p className="mt-1 font-mono text-[12px] text-zinc-500">{selectedService.serviceId}</p>
                    </div>
                    <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                      {formatPricing(selectedService.pricing)}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-zinc-400">
                    {selectedService.summary?.trim() || "No summary provided by provider manifest."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Endpoint</p>
                    <p className="mt-2 break-all font-mono text-[12px] text-zinc-300">{selectedService.endpoint || selectedService.invoke?.url || "Unavailable"}</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Auth</p>
                    <p className="mt-2 text-sm text-zinc-300">{selectedService.auth?.type || "public"}</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Method</p>
                    <p className="mt-2 text-sm text-zinc-300">{selectedService.invoke?.method || "POST"}</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Runtime</p>
                    <p className="mt-2 text-sm text-zinc-300">{resolveConstraintLabel(selectedService)}</p>
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Input schema</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {inputKeys.length > 0 ? inputKeys.map((key) => (
                      <span key={key} className="rounded-full border border-white/10 bg-black px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                        {key}
                      </span>
                    )) : <span className="text-sm text-zinc-500">Provider did not expose schema keys.</span>}
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Output schema</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {outputKeys.length > 0 ? outputKeys.map((key) => (
                      <span key={key} className="rounded-full border border-white/10 bg-black px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                        {key}
                      </span>
                    )) : <span className="text-sm text-zinc-500">Provider did not expose response schema keys.</span>}
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Operator actions</p>
                  <div className="mt-4 flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCopy(selectedService.serviceId, "Service ID")}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/[0.06]"
                    >
                      <Copy className="h-4 w-4" />
                      Copy service id
                    </button>
                    {selectedService.endpoint ? (
                      <button
                        type="button"
                        onClick={() => void handleCopy(selectedService.endpoint, "Endpoint")}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/[0.06]"
                      >
                        <Globe className="h-4 w-4" />
                        Copy endpoint
                      </button>
                    ) : null}
                    <Link
                      href="/dashboard/console"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
                    >
                      Prepare invoke console
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <ShieldCheck className="h-4 w-4" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Safety reminder</p>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Owner session and credentials control access. The public discovery surface should help the agent choose a service without leaking provider settlement internals.
                  </p>
                </div>
              </div>
            ) : (
              <ManifestPreviewEmptyState />
            )}
          </aside>
        </section>
      </div>
    </div>
  );
}
