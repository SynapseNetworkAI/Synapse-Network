import XSelect from "@/components/xui/XSelect";

type StatusFilterProps<T extends string> = {
  id: string;
  label?: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  getOptionLabel?: (value: T) => string;
};

export default function StatusFilter<T extends string>({
  id,
  label = "status",
  options,
  value,
  onChange,
  getOptionLabel,
}: Readonly<StatusFilterProps<T>>) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      <XSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options.map((option) => ({
          value: option,
          label: getOptionLabel ? getOptionLabel(option) : option,
        }))}
        triggerClassName="inline-flex min-h-9 items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white"
      />
    </div>
  );
}
