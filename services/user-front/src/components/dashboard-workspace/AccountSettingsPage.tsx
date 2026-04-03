"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Mail, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useAccount, useSignMessage } from "wagmi";
import { XButton } from "@/components/xui/XButton";
import { XInput } from "@/components/xui/XInput";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import { getStoredAuthSession } from "@/utils/authSession";
import {
  getOwnerProfile,
  requestOwnerProfileChallenge,
  type OwnerProfile,
  updateOwnerProfile,
} from "@/utils/accountProfileApi";
import {
  isWalletUnstableError,
  signWalletMessage,
} from "@/utils/walletSignature";

type AccountSettingsForm = {
  displayName: string;
  email: string;
  notifyMarketing: boolean;
  notifyAlerts: boolean;
};

const EMPTY_FORM: AccountSettingsForm = {
  displayName: "",
  email: "",
  notifyMarketing: true,
  notifyAlerts: true,
};

function maskWallet(wallet: string | null): string {
  if (!wallet) {
    return "";
  }
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  if (!value) {
    return true;
  }
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function toPayload(form: AccountSettingsForm) {
  return {
    displayName: form.displayName.trim() || null,
    email: normalizeEmail(form.email) || null,
    notifyMarketing: form.notifyMarketing,
    notifyAlerts: form.notifyAlerts,
  };
}

function profileToForm(profile: OwnerProfile): AccountSettingsForm {
  return {
    displayName: profile.displayName ?? "",
    email: profile.email ?? "",
    notifyMarketing: profile.notifyMarketing,
    notifyAlerts: profile.notifyAlerts,
  };
}

function formsEqual(a: AccountSettingsForm, b: AccountSettingsForm): boolean {
  return (
    a.displayName.trim() === b.displayName.trim() &&
    normalizeEmail(a.email) === normalizeEmail(b.email) &&
    a.notifyMarketing === b.notifyMarketing &&
    a.notifyAlerts === b.notifyAlerts
  );
}

function SettingToggle({
  title,
  description,
  checked,
  onChange,
  disabled,
}: Readonly<{
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}>) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
      <div className="space-y-1">
        <p className="text-[15px] font-medium tracking-[-0.01em] text-white">
          {title}
        </p>
        <p className="max-w-[460px] text-[13px] leading-6 text-white/52">
          {description}
        </p>
      </div>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span className="h-7 w-12 rounded-full border border-white/10 bg-white/[0.09] transition peer-checked:bg-[#7ff7be]/28 peer-disabled:opacity-40" />
        <span className="absolute left-[4px] top-[4px] h-5 w-5 rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.32)] transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export default function AccountSettingsPage() {
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const { authorize, isSessionAuthenticated, isAuthorizing } = useAuth();
  const { signMessageAsync } = useSignMessage();
  const [profile, setProfile] = useState<OwnerProfile | null>(null);
  const [form, setForm] = useState<AccountSettingsForm>(EMPTY_FORM);
  const [baselineForm, setBaselineForm] = useState<AccountSettingsForm>(EMPTY_FORM);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const sessionWallet = useMemo(() => getStoredAuthSession()?.wallet ?? null, []);
  const boundWallet = address?.toLowerCase() ?? sessionWallet;
  const hasLiveWallet = Boolean(address && isConnected);
  const hasStoredSession = Boolean(sessionWallet);

  const loadProfile = useCallback(async () => {
    if (!boundWallet) {
      setProfile(null);
      setForm(EMPTY_FORM);
      setBaselineForm(EMPTY_FORM);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      if (!isSessionAuthenticated && !hasStoredSession) {
        const ok = await authorize();
        if (!ok) {
          throw new Error(t("accountSettingsPage.authorizeFirst"));
        }
      }

      const nextProfile = await getOwnerProfile(boundWallet);
      const nextForm = profileToForm(nextProfile);
      setProfile(nextProfile);
      setForm(nextForm);
      setBaselineForm(nextForm);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("accountSettingsPage.loadFailed");
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [authorize, boundWallet, hasStoredSession, isSessionAuthenticated, t]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const updateField = useCallback(
    <K extends keyof AccountSettingsForm>(key: K, value: AccountSettingsForm[K]) => {
      setForm((current) => ({
        ...current,
        [key]: value,
      }));
    },
    []
  );

  const emailError = useMemo(() => {
    if (!form.email.trim()) {
      return null;
    }
    if (isValidEmail(form.email.trim())) {
      return null;
    }
    return t("accountSettingsPage.invalidEmail");
  }, [form.email, t]);

  const hasChanges = useMemo(
    () => !formsEqual(form, baselineForm),
    [form, baselineForm]
  );

  const canSave =
    Boolean(boundWallet) &&
    hasLiveWallet &&
    hasChanges &&
    !emailError &&
    !isSaving &&
    !isAuthorizing;

  const onSave = useCallback(async () => {
    if (!boundWallet) {
      toast.error(t("accountSettingsPage.walletRequired"));
      return;
    }
    if (!hasLiveWallet || !address) {
      toast.error(t("accountSettingsPage.connectWalletToSave"));
      return;
    }
    if (emailError) {
      toast.error(emailError);
      return;
    }

    setIsSaving(true);
    try {
      if (!isSessionAuthenticated) {
        const ok = await authorize();
        if (!ok) {
          throw new Error(t("accountSettingsPage.authorizeFirst"));
        }
      }

      const payload = toPayload(form);
      const challenge = await requestOwnerProfileChallenge(boundWallet, payload);
      const signature = await signWalletMessage(challenge, address, signMessageAsync);
      const savedProfile = await updateOwnerProfile(boundWallet, {
        ...payload,
        message: challenge,
        signature,
      });
      const nextForm = profileToForm(savedProfile);
      setProfile(savedProfile);
      setForm(nextForm);
      setBaselineForm(nextForm);
      setLoadError(null);
      toast.success(t("accountSettingsPage.saveSuccess"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("accountSettingsPage.saveFailed");
      if (
        isWalletUnstableError(message) ||
        message.includes("Connector not connected")
      ) {
        toast.error(t("accountSettingsPage.walletReconnectRequired"));
      } else {
        toast.error(message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    address,
    authorize,
    boundWallet,
    emailError,
    form,
    hasLiveWallet,
    isSessionAuthenticated,
    isAuthorizing,
    signMessageAsync,
    t,
  ]);

  return (
    <div className="mx-auto w-full max-w-[1024px] px-8 py-10">
      <div className="border-b border-white/8 pb-9">
        <h1 className="text-[42px] font-semibold tracking-[-0.04em] text-white">
          {t("accountSettingsPage.title")}
        </h1>
        <p className="mt-3 max-w-[760px] text-[18px] leading-7 text-[#8b98b4]">
          {t("accountSettingsPage.description")}
        </p>
      </div>

      <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="rounded-[24px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#7ff7be]">
              <UserRound className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">
                {t("accountSettingsPage.profileTitle")}
              </h2>
              <p className="mt-1 text-[13px] text-white/44">
                {t("accountSettingsPage.profileDescription")}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-5">
            <div className="grid gap-2">
              <label
                htmlFor="account-settings-display-name"
                className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/40"
              >
                {t("accountSettingsPage.nameLabel")}
              </label>
              <XInput
                id="account-settings-display-name"
                value={form.displayName}
                onChange={(event) => updateField("displayName", event.target.value)}
                placeholder={t("accountSettingsPage.namePlaceholder")}
                maxLength={64}
                className="rounded-[18px] border border-white/8 bg-black/20 py-3.5 text-[15px]"
              />
              <p className="text-[12px] text-white/42">
                {t("accountSettingsPage.nameHelp")}
              </p>
            </div>

            <div className="grid gap-2">
              <label
                htmlFor="account-settings-email"
                className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/40"
              >
                {t("accountSettingsPage.emailLabel")}
              </label>
              <XInput
                id="account-settings-email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                placeholder={t("accountSettingsPage.emailPlaceholder")}
                inputMode="email"
                autoComplete="email"
                className="rounded-[18px] border border-white/8 bg-black/20 py-3.5 text-[15px]"
              />
              <p className={`text-[12px] ${emailError ? "text-[#ff7b7b]" : "text-white/42"}`}>
                {emailError ??
                  (profile?.emailVerified
                    ? t("accountSettingsPage.emailVerified")
                    : t("accountSettingsPage.emailHelp"))}
              </p>
            </div>

            <div className="grid gap-3 pt-3">
              <SettingToggle
                title={t("accountSettingsPage.notifyMarketingTitle")}
                description={t("accountSettingsPage.notifyMarketingDescription")}
                checked={form.notifyMarketing}
                onChange={(next) => updateField("notifyMarketing", next)}
                disabled={isSaving}
              />
              <SettingToggle
                title={t("accountSettingsPage.notifyAlertsTitle")}
                description={t("accountSettingsPage.notifyAlertsDescription")}
                checked={form.notifyAlerts}
                onChange={(next) => updateField("notifyAlerts", next)}
                disabled={isSaving}
              />
            </div>

            {loadError ? (
              <div className="rounded-[18px] border border-[#4a1f1f] bg-[#2a1111] px-4 py-3 text-[13px] text-[#ffb4b4]">
                {loadError}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4 border-t border-white/8 pt-5">
              <p className="text-[13px] leading-6 text-white/42">
                {hasLiveWallet
                  ? t("accountSettingsPage.saveHint")
                  : t("accountSettingsPage.saveRequiresWallet")}
              </p>
              <XButton
                variant="primary"
                size="pill"
                onClick={() => void onSave()}
                disabled={!canSave}
                className="min-w-[164px]"
              >
                {isSaving
                  ? t("accountSettingsPage.saving")
                  : t("accountSettingsPage.saveButton")}
              </XButton>
            </div>
          </div>
        </section>

        <aside className="grid gap-6 self-start">
          <section className="rounded-[24px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#7fb5ff]">
                <Wallet className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
                  {t("accountSettingsPage.walletCardTitle")}
                </h2>
                <p className="mt-1 text-[13px] text-white/42">
                  {t("accountSettingsPage.connectedWallet")}
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
              <p className="text-[15px] font-medium text-white/88">
                {boundWallet
                  ? maskWallet(boundWallet)
                  : t("accountSettingsPage.notConnected")}
              </p>
              <p className="mt-1 text-[12px] text-white/42 break-all">
                {boundWallet ?? t("accountSettingsPage.walletSessionMissing")}
              </p>
            </div>
          </section>

          <section className="rounded-[24px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#f6c25b]">
                <Mail className="h-5 w-5" />
              </span>
              <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
                {t("accountSettingsPage.identitySummaryTitle")}
              </h2>
            </div>
            <div className="mt-5 space-y-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/36">
                  {t("accountSettingsPage.nameLabel")}
                </span>
                <span className="text-[14px] text-white/88">
                  {profile?.displayName || t("accountSettingsPage.unset")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/36">
                  {t("accountSettingsPage.emailLabel")}
                </span>
                <span className="text-right text-[14px] text-white/88">
                  {profile?.email || t("accountSettingsPage.unset")}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#7ff7be]">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
                {t("accountSettingsPage.securityTitle")}
              </h2>
            </div>
            <p className="mt-5 text-[14px] leading-7 text-white/58">
              {isLoading
                ? t("accountSettingsPage.loading")
                : t("accountSettingsPage.securityDescription")}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
