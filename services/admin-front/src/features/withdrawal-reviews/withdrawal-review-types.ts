export type WithdrawalReviewFilters = {
  query: string;
  riskLevel: string;
};

export const DEFAULT_WITHDRAWAL_REVIEW_FILTERS: WithdrawalReviewFilters = {
  query: "",
  riskLevel: "all",
};

export const WITHDRAWAL_REVIEW_PAGE_SIZE = 6;

export const WITHDRAWAL_REVIEW_PAGE_SIZE_OPTIONS = [6, 10, 20];
