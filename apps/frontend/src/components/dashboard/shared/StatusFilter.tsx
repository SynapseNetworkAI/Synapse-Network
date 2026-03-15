type StatusFilterProps<T extends string> = {
  id: string;
  label?: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
};

export default function StatusFilter<T extends string>({
  id,
  label = "status",
  options,
  value,
  onChange,
}: StatusFilterProps<T>) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="px-3 py-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}
