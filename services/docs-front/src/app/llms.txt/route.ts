import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

const criticalNotes = `## Critical Runtime Notes

- Matured Funds: Consumer withdrawals are T+7 before funds become withdrawable.
- Matured Funds: Provider earnings are T+7 before receivables become withdrawable.
- Dynamic pricing: do not hard-code fees or prices from docs.
- Example values only: PLATFORM_FEE_RATE=10%, CONSUMER_WITHDRAW_FEE_USDC=0.50 USDC, GATEWAY_ROUTING_TAX=0.000100 USDC.
- Runtime truth comes from Gateway responses: discover_services, invoke response, receipt, withdrawal ticket, and fee policy.
- MCP pricing rules: call discover_services before invoke_and_pay, copy fixed-price costUsdc, use maxCostUsdc for token-metered services, and rediscover on PRICE_MISMATCH.
`;

export function GET() {
  return new Response(`${llms(source).index()}\n\n${criticalNotes}`);
}
