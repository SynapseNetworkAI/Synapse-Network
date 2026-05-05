import { buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import { normalizeMoneyString, type MoneyString } from "@/utils/money";

export type RefundRecord = {
  id: string; // pseudo id or tx_hash if available
  timestamp: number;
  amountUsdc: MoneyString;
  type: "refund" | "settlement";
  status: "PENDING" | "COMPLETED";
  txHash: string | null;
};

// 与后端 /api/v1/refunds 真实接口对接
export async function fetchRefunds(
  userAddress: string,
  limit: number = 50
): Promise<RefundRecord[]> {
  if (!userAddress) return [];
  try {
    const res = await fetch(
      `${getGatewayBaseUrl()}/api/v1/refunds?limit=${encodeURIComponent(
        String(limit)
      )}`,
      {
        method: "GET",
        headers: buildAuthedHeaders(userAddress, false),
      }
    );

    if (!res.ok) {
      throw new Error("Failed to fetch refunds history");
    }

    const data = (await res.json()) as {
      status?: string;
      refunds?: RefundRecord[];
      data?: RefundRecord[];
    };
    const raw =
      data.status === "success" && Array.isArray(data.refunds)
        ? data.refunds
        : data.status === "success" && Array.isArray(data.data)
        ? data.data
        : [];

    return raw
      .map((row) => row as Record<string, unknown>)
      .filter(
        (row) =>
          String(row.refundType || "").toUpperCase() !==
          "CONSUMER_BALANCE_WITHDRAW"
      )
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
        timestamp: row.createdAt
          ? Math.floor(new Date(String(row.createdAt)).getTime() / 1000)
          : 0,
        amountUsdc: normalizeMoneyString(row.amountUsdc),
        type: "refund" as const,
        status:
          String(row.status || "").toUpperCase() === "COMPLETED"
            ? "COMPLETED"
            : "PENDING",
        txHash: typeof row.txHash === "string" ? row.txHash : null,
      }));
  } catch (err) {
    console.error("fetchRefunds error:", err);
    return [];
  }
}
