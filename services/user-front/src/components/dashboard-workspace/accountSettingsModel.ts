import type { OwnerProfile } from "@/utils/accountProfileApi";

export type AccountSettingsForm = {
  displayName: string;
  email: string;
  notifyMarketing: boolean;
  notifyAlerts: boolean;
};

export const EMPTY_FORM: AccountSettingsForm = {
  displayName: "",
  email: "",
  notifyMarketing: true,
  notifyAlerts: true,
};

export const INPUT_CLASSES =
  "h-9 rounded-[10px] border border-[#2f3336] bg-transparent px-3 py-0 text-[13px] leading-5 text-white placeholder:text-[#71767b] focus-visible:border-[#536471]";

export const PRIMARY_BUTTON_CLASSES =
  "inline-flex h-9 items-center justify-center rounded-full border border-white/80 bg-white/95 px-4 text-[13px] font-semibold leading-none text-neutral-900 shadow-[0_0_30px_rgba(255,255,255,0.12)] transition-[box-shadow,transform,background-color] duration-200 hover:bg-white hover:shadow-[0_0_40px_rgba(255,255,255,0.2)] disabled:cursor-not-allowed disabled:opacity-45";

export function maskWallet(wallet: string | null): string {
  if (!wallet) {
    return "";
  }
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  if (!value) {
    return true;
  }
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function toPayload(form: AccountSettingsForm) {
  return {
    displayName: form.displayName.trim() || null,
    email: normalizeEmail(form.email) || null,
    notifyMarketing: form.notifyMarketing,
    notifyAlerts: form.notifyAlerts,
  };
}

export function profileToForm(profile: OwnerProfile): AccountSettingsForm {
  return {
    displayName: profile.displayName ?? "",
    email: profile.email ?? "",
    notifyMarketing: profile.notifyMarketing,
    notifyAlerts: profile.notifyAlerts,
  };
}

export function formsEqual(
  a: AccountSettingsForm,
  b: AccountSettingsForm
): boolean {
  return (
    a.displayName.trim() === b.displayName.trim() &&
    normalizeEmail(a.email) === normalizeEmail(b.email) &&
    a.notifyMarketing === b.notifyMarketing &&
    a.notifyAlerts === b.notifyAlerts
  );
}
