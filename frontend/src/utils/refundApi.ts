import { buildAuthedHeaders } from "@/utils/authSession";

export type RefundRecord = {
  id: string; // pseudo id or tx_hash if available
  timestamp: number;
  amount: number;
  type: "refund" | "settlement";
  status: "PENDING" | "COMPLETED";
  txHash: string | null;
};

// 与后端 /api/v2/refunds 真实接口对接
export async function fetchRefunds(userAddress: string): Promise<RefundRecord[]> {
  if (!userAddress) return [];
  try {
    const res = await fetch(`http://127.0.0.1:8000/api/v2/refunds`, {
      method: "GET",
      headers: buildAuthedHeaders(userAddress, false),
    });
    
    if (!res.ok) {
      throw new Error("Failed to fetch refunds history");
    }
    
    const data = (await res.json()) as {
      status?: string;
      refunds?: RefundRecord[];
      data?: RefundRecord[];
    };
    if (data.status === "success" && Array.isArray(data.refunds)) {
      return data.refunds;
    }
    if (data.status === "success" && Array.isArray(data.data)) {
      return data.data;
    }
    return [];
  } catch (err) {
    console.error("fetchRefunds error:", err);
    return [];
  }
}
