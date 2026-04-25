"use client";

type SdkApiCheatsheetRows = {
  methods: string[];
  returns: string[];
  descriptions: string[];
};

type SdkApiCheatsheetProps = {
  title: string;
  methodLabel: string;
  returnsLabel: string;
  descriptionLabel: string;
  authRows: SdkApiCheatsheetRows;
  clientRows: SdkApiCheatsheetRows;
};

function SdkApiTable({
  label,
  methodLabel,
  returnsLabel,
  descriptionLabel,
  rows,
}: {
  label: string;
  methodLabel: string;
  returnsLabel: string;
  descriptionLabel: string;
  rows: SdkApiCheatsheetRows;
}) {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[#4e535a]">{label}</div>
      <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                {methodLabel}
              </th>
              <th className="hidden px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a] md:table-cell">
                {returnsLabel}
              </th>
              <th className="hidden px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a] md:table-cell">
                {descriptionLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.methods.map((method, index) => (
              <tr key={method} className="border-b border-white/[0.04] last:border-b-0">
                <td className="px-4 py-3">
                  <code className="font-mono text-[12px] text-[#7ff7be]">{method}</code>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <code className="font-mono text-[11px] text-[#6eb6f6]">{rows.returns[index] ?? ""}</code>
                </td>
                <td className="hidden px-4 py-3 text-[12px] text-[#8b98a5] md:table-cell">
                  {rows.descriptions[index] ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SdkApiCheatsheet({
  title,
  methodLabel,
  returnsLabel,
  descriptionLabel,
  authRows,
  clientRows,
}: SdkApiCheatsheetProps) {
  return (
    <section className="space-y-5">
      <h2 className="x-section-title text-white">{title}</h2>
      <SdkApiTable
        label="SynapseAuth"
        methodLabel={methodLabel}
        returnsLabel={returnsLabel}
        descriptionLabel={descriptionLabel}
        rows={authRows}
      />
      <div className="pt-2">
        <SdkApiTable
          label="SynapseClient"
          methodLabel={methodLabel}
          returnsLabel={returnsLabel}
          descriptionLabel={descriptionLabel}
          rows={clientRows}
        />
      </div>
    </section>
  );
}
