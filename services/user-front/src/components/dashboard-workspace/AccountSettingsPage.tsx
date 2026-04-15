"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAccount, useSignMessage } from "wagmi";
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
    <label className="inline-flex items-center justify-end">
      <span className="sr-only">{title}. {description}</span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span className="h-6 w-10 rounded-full border border-white/12 bg-white/[0.08] transition peer-checked:border-[#7ff7be]/30 peer-checked:bg-[#7ff7be]/20 peer-disabled:opacity-40" />
        <span className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.28)] transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function SettingsRow({
  title,
  description,
  control,
  noBorder = false,
}: Readonly<{
  title: string;
  description?: string;
  control: React.ReactNode;
  noBorder?: boolean;
}>) {
  return (
    <section className={noBorder ? "py-3.5" : "border-b border-[#1e1e1e] py-3.5"}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="max-w-[474px] min-w-0">
          <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.01em] text-white">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-[12px] leading-4 text-[#6b7280]">
              {description}
            </p>
          ) : null}
        </div>
        <div className="w-full max-w-[264px] shrink-0">{control}</div>
      </div>
    </section>
  );
}

const INPUT_CLASSES =
  "h-9 rounded-[10px] border border-[#2f3336] bg-transparent px-3 py-0 text-[13px] leading-5 text-white placeholder:text-[#71767b] focus-visible:border-[#536471]";

const PRIMARY_BUTTON_CLASSES =
  "inline-flex h-9 items-center justify-center rounded-full border border-white/80 bg-white/95 px-4 text-[13px] font-semibold leading-none text-neutral-900 shadow-[0_0_30px_rgba(255,255,255,0.12)] transition-[box-shadow,transform,background-color] duration-200 hover:bg-white hover:shadow-[0_0_40px_rgba(255,255,255,0.2)] disabled:cursor-not-allowed disabled:opacity-45";

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
    signMessageAsync,
    t,
  ]);

  const emailStatusText = emailError
    ? emailError
    : profile?.emailVerified
      ? t("accountSettingsPage.emailVerified")
      : t("accountSettingsPage.emailHelp");

  return (
    <div className="mx-auto w-full max-w-[1024px] px-8 py-6">
      <div className="mx-auto w-full max-w-[768px]">
        <header className="border-b border-[#1e1e1e] pb-4 mb-0">
          <h1 className="text-[18px] font-semibold leading-7 text-white">
            {t("accountSettingsPage.title")}
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            {t("accountSettingsPage.description")}
          </p>
        </header>

        <div>
          <SettingsRow
            title={t("accountSettingsPage.nameLabel")}
            control={
              <div className="space-y-2">
                <label className="block">
                  <span className="sr-only">{t("accountSettingsPage.nameLabel")}</span>
                  <XInput
                    id="account-settings-display-name"
                    value={form.displayName}
                    onChange={(event) => updateField("displayName", event.target.value)}
                    placeholder={t("accountSettingsPage.namePlaceholder")}
                    maxLength={64}
                    className={INPUT_CLASSES}
                  />
                </label>
              </div>
            }
          />

          <SettingsRow
            title={t("accountSettingsPage.emailLabel")}
            control={
              <div className="space-y-2">
                <label className="block">
                  <span className="sr-only">{t("accountSettingsPage.emailLabel")}</span>
                  <XInput
                    id="account-settings-email"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    placeholder={t("accountSettingsPage.emailPlaceholder")}
                    inputMode="email"
                    autoComplete="email"
                    className={INPUT_CLASSES}
                  />
                </label>
                <p className={`text-[12px] leading-4 ${emailError ? "text-[#ff8b8b]" : "text-[#71767b]"}`}>
                  {emailStatusText}
                </p>
              </div>
            }
          />

          <SettingsRow
            title={t("accountSettingsPage.notifyMarketingTitle")}
            description={t("accountSettingsPage.notifyMarketingDescription")}
            control={
              <div className="flex h-9 items-center justify-end">
                <SettingToggle
                  title={t("accountSettingsPage.notifyMarketingTitle")}
                  description={t("accountSettingsPage.notifyMarketingDescription")}
                  checked={form.notifyMarketing}
                  onChange={(next) => updateField("notifyMarketing", next)}
                  disabled={isSaving}
                />
              </div>
            }
          />

          <SettingsRow
            title={t("accountSettingsPage.notifyAlertsTitle")}
            description={t("accountSettingsPage.notifyAlertsDescription")}
            control={
              <div className="flex h-9 items-center justify-end">
                <SettingToggle
                  title={t("accountSettingsPage.notifyAlertsTitle")}
                  description={t("accountSettingsPage.notifyAlertsDescription")}
                  checked={form.notifyAlerts}
                  onChange={(next) => updateField("notifyAlerts", next)}
                  disabled={isSaving}
                />
              </div>
            }
          />

          <SettingsRow
            title={t("accountSettingsPage.connectedWallet")}
            description={
              boundWallet
                ? t("accountSettingsPage.walletRowDescription")
                : t("accountSettingsPage.notConnected")
            }
            control={
              <div className="rounded-[10px] border border-[#2f3336] bg-transparent px-3 py-2.5">
                <p className="text-[13px] font-medium leading-5 text-white">
                  {boundWallet ? maskWallet(boundWallet) : t("accountSettingsPage.unset")}
                </p>
                <p className="mt-0.5 break-all text-[12px] leading-4 text-[#71767b]">
                  {boundWallet ?? t("accountSettingsPage.walletRequired")}
                </p>
              </div>
            }
          />

          <SettingsRow
            title={t("accountSettingsPage.saveRowTitle")}
            description={
              isLoading ? t("accountSettingsPage.loading") : undefined
            }
            noBorder
            control={
              <div className="flex flex-col items-start gap-3 md:items-end">
                <button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={!canSave}
                  className={PRIMARY_BUTTON_CLASSES}
                >
                  {isSaving
                    ? t("accountSettingsPage.saving")
                    : t("accountSettingsPage.saveButton")}
                </button>
                {loadError ? (
                  <p className="text-right text-[12px] leading-4 text-[#ff8b8b]">
                    {loadError}
                  </p>
                ) : (
                  <p className="text-right text-[12px] leading-4 text-[#71767b]">
                    {hasLiveWallet
                      ? t("accountSettingsPage.saveHint")
                      : t("accountSettingsPage.saveRequiresWallet")}
                  </p>
                )}
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
