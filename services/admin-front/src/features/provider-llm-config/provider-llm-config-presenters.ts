import type {
  ProviderLlmConfigSnapshot,
  ProviderLlmPricingReview,
  ProviderLlmRolloutState,
} from "@/services/provider-llm-config-api";

export type ProviderLlmRolloutAction = "smoke" | "prod_enable";

export type ProviderLlmRolloutMetrics = {
  models: number;
  pricingBlocked: number;
  prodOptIn: number;
  vendors: number;
};

export const EMPTY_PROVIDER_LLM_ROLLOUT_METRICS: ProviderLlmRolloutMetrics = {
  models: 0,
  pricingBlocked: 0,
  prodOptIn: 0,
  vendors: 0,
};

export function findProviderLlmRollout(
  rollouts: ProviderLlmRolloutState[],
  serviceId: string
): ProviderLlmRolloutState | null {
  return rollouts.find((rollout) => rollout.serviceId === serviceId) ?? null;
}

export function getProviderLlmServiceId(
  model: Readonly<{ boundServiceIds: string[]; modelId: string }>
): string {
  return model.boundServiceIds[0] ?? model.modelId;
}

export function buildProviderLlmRolloutMetrics(
  snapshot: ProviderLlmConfigSnapshot | null
): ProviderLlmRolloutMetrics {
  if (!snapshot) {
    return EMPTY_PROVIDER_LLM_ROLLOUT_METRICS;
  }

  return {
    vendors: snapshot.vendors.length,
    models: snapshot.models.length,
    pricingBlocked: countProviderLlmPricingBlocked(snapshot.pricingReviews),
    prodOptIn: countProviderLlmProdOptIn(snapshot.rolloutStates),
  };
}

export function resolveProviderLlmRolloutEnvironment(
  action: ProviderLlmRolloutAction
): "prod" | "staging" {
  return action === "prod_enable" ? "prod" : "staging";
}

export function buildProviderLlmRolloutNote(
  action: ProviderLlmRolloutAction
): string {
  return `${action} requested from LLM config control plane.`;
}

export function formatProviderLlmRolloutNotice(result: {
  blockedReason: string | null;
  serviceId: string;
  status: string;
}): string {
  if (result.blockedReason) {
    return `${result.serviceId} 已生成 blocked request: ${result.blockedReason}`;
  }
  return `${result.serviceId} 已进入 ${result.status} 队列`;
}

function countProviderLlmPricingBlocked(
  reviews: ProviderLlmPricingReview[]
): number {
  return reviews.filter(isProviderLlmPricingBlocked).length;
}

function countProviderLlmProdOptIn(
  rollouts: ProviderLlmRolloutState[]
): number {
  return rollouts.filter((item) => item.prodOptIn).length;
}

function isProviderLlmPricingBlocked(
  review: ProviderLlmPricingReview
): boolean {
  return review.pricingStatus === "operator_review_required";
}
