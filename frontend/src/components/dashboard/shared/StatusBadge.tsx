type DeductionStatus = "accepted" | "succeeded" | "refunded" | "failed";

type StatusBadgeProps = {
  status: DeductionStatus;
};

const STATUS_CLASS: Record<DeductionStatus, string> = {
  succeeded: "text-green-300 border-green-500/40 bg-green-500/10",
  accepted: "text-blue-300 border-blue-500/40 bg-blue-500/10",
  refunded: "text-yellow-300 border-yellow-500/40 bg-yellow-500/10",
  failed: "text-red-300 border-red-500/40 bg-red-500/10",
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`px-2 py-1 text-xs rounded border ${STATUS_CLASS[status]}`}>{status}</span>;
}
