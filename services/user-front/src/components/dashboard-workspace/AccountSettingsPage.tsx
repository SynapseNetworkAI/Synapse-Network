"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAccount, useSignMessage } from "wagmi";
import {
  SettingToggle,
  SettingsRow,
} from "@/components/dashboard-workspace/AccountSettingsControls";
import EmailVerificationCodeModal from "@/components/dashboard-workspace/EmailVerificationCodeModal";
import CopyableValue from "@/components/xui/CopyableValue";
import { XInput } from "@/components/xui/XInput";
import ConfirmActionDialog from "@/components/xui/ConfirmActionDialog";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import { getStoredAuthSession } from "@/utils/authSession";
import {
  getOwnerProfile,
  resendOwnerEmailCode,
  requestOwnerProfileChallenge,
  type OwnerProfile,
  updateOwnerProfile,
  verifyOwnerEmailCode,
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
  const [baselineForm, setBaselineForm] =
    useState<AccountSettingsForm>(EMPTY_FORM);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null
  );
  const [isVerificationOpen, setIsVerificationOpen] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [isRemoveEmailConfirmOpen, setIsRemoveEmailConfirmOpen] =
    useState(false);

  const sessionWallet = useMemo(
    () => getStoredAuthSession()?.wallet ?? null,
    []
  );
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
      setIsChangingEmail(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("accountSettingsPage.loadFailed");
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [authorize, boundWallet, hasStoredSession, isSessionAuthenticated, t]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const updateField = useCallback(
    <K extends keyof AccountSettingsForm>(
      key: K,
      value: AccountSettingsForm[K]
    ) => {
      setForm((current) => ({
        ...current,
        [key]: value,
      }));
    },
    []
  );

  const emailError = useMemo(() => {
    if (!form.email.trim()) {
      if (isChangingEmail) {
        return t("accountSettingsPage.invalidEmail");
      }
      return null;
    }
    if (isValidEmail(form.email.trim())) {
      return null;
    }
    return t("accountSettingsPage.invalidEmail");
  }, [form.email, isChangingEmail, t]);

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
      const challenge = await requestOwnerProfileChallenge(
        boundWallet,
        payload
      );
      const signature = await signWalletMessage(
        challenge,
        address,
        signMessageAsync
      );
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
      if (savedProfile.pendingEmail) {
        setVerificationEmail(savedProfile.pendingEmail);
        setIsVerificationOpen(true);
        setIsChangingEmail(false);
        toast.success(t("accountSettingsPage.emailVerificationSent"));
      } else {
        setIsChangingEmail(false);
        toast.success(t("accountSettingsPage.saveSuccess"));
      }
    } catch (error) {
      console.error("Failed to save account settings:", error);
      const message = error instanceof Error ? error.message : "";
      if (
        isWalletUnstableError(message) ||
        message.includes("Connector not connected")
      ) {
        toast.error(t("accountSettingsPage.walletReconnectRequired"));
      } else {
        toast.error(t("accountSettingsPage.saveFailed"));
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

  const onVerifyEmailCode = useCallback(
    async (code: string) => {
      if (!boundWallet || !verificationEmail) {
        throw new Error(t("accountSettingsPage.walletRequired"));
      }
      const verifiedProfile = await verifyOwnerEmailCode(boundWallet, {
        email: verificationEmail,
        code,
      });
      const nextForm = profileToForm(verifiedProfile);
      setProfile(verifiedProfile);
      setForm(nextForm);
      setBaselineForm(nextForm);
      setVerificationEmail(null);
      setIsVerificationOpen(false);
      toast.success(t("accountSettingsPage.emailVerificationSuccess"));
    },
    [boundWallet, t, verificationEmail]
  );

  const onResendEmailCode = useCallback(async () => {
    if (!boundWallet || !verificationEmail) {
      throw new Error(t("accountSettingsPage.walletRequired"));
    }
    const nextProfile = await resendOwnerEmailCode(
      boundWallet,
      verificationEmail
    );
    setProfile(nextProfile);
    setForm(profileToForm(nextProfile));
    setBaselineForm(profileToForm(nextProfile));
  }, [boundWallet, t, verificationEmail]);

  const submitSignedProfile = useCallback(
    async (nextForm: AccountSettingsForm) => {
      if (!boundWallet || !address) {
        throw new Error(t("accountSettingsPage.walletRequired"));
      }
      if (!isSessionAuthenticated) {
        const ok = await authorize();
        if (!ok) {
          throw new Error(t("accountSettingsPage.authorizeFirst"));
        }
      }
      const payload = toPayload(nextForm);
      const challenge = await requestOwnerProfileChallenge(
        boundWallet,
        payload
      );
      const signature = await signWalletMessage(
        challenge,
        address,
        signMessageAsync
      );
      return updateOwnerProfile(boundWallet, {
        ...payload,
        message: challenge,
        signature,
      });
    },
    [
      address,
      authorize,
      boundWallet,
      isSessionAuthenticated,
      signMessageAsync,
      t,
    ]
  );

  const onCancelPendingEmail = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (!hasLiveWallet || !address) {
      toast.error(t("accountSettingsPage.connectWalletToSave"));
      return;
    }
    setIsSaving(true);
    try {
      const nextProfile = await submitSignedProfile({
        ...form,
        email: profile.email ?? "",
      });
      const nextForm = profileToForm(nextProfile);
      setProfile(nextProfile);
      setForm(nextForm);
      setBaselineForm(nextForm);
      setVerificationEmail(null);
      setIsVerificationOpen(false);
      setIsChangingEmail(false);
      toast.success(t("accountSettingsPage.emailChangeCancelled"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("accountSettingsPage.saveFailed")
      );
    } finally {
      setIsSaving(false);
    }
  }, [address, form, hasLiveWallet, profile, submitSignedProfile, t]);

  const executeRemoveEmail = useCallback(async () => {
    if (!profile?.email) {
      return;
    }
    if (!hasLiveWallet || !address) {
      toast.error(t("accountSettingsPage.connectWalletToSave"));
      return;
    }
    setIsSaving(true);
    try {
      const nextProfile = await submitSignedProfile({
        ...form,
        email: "",
      });
      const nextForm = profileToForm(nextProfile);
      setProfile(nextProfile);
      setForm(nextForm);
      setBaselineForm(nextForm);
      setVerificationEmail(null);
      setIsVerificationOpen(false);
      setIsChangingEmail(false);
      toast.success(t("accountSettingsPage.emailRemoved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("accountSettingsPage.saveFailed")
      );
    } finally {
      setIsSaving(false);
    }
  }, [address, form, hasLiveWallet, profile, submitSignedProfile, t]);

  const onRemoveEmail = useCallback(() => {
    if (!profile?.email) {
      return;
    }
    if (!hasLiveWallet || !address) {
      toast.error(t("accountSettingsPage.connectWalletToSave"));
      return;
    }
    setIsRemoveEmailConfirmOpen(true);
  }, [address, hasLiveWallet, profile, t]);

  const onConfirmRemoveEmail = useCallback(async () => {
    await executeRemoveEmail();
    setIsRemoveEmailConfirmOpen(false);
  }, [executeRemoveEmail]);

  const emailStatusText = useMemo(() => {
    if (emailError) {
      return emailError;
    }
    if (profile?.pendingEmail) {
      if (profile.emailVerificationStatus === "locked") {
        return t("accountSettingsPage.emailVerificationLocked");
      }
      if (profile.emailVerificationStatus === "expired") {
        return t("accountSettingsPage.emailVerificationExpired");
      }
      return t("accountSettingsPage.emailPending").replace(
        "{{email}}",
        profile.pendingEmail
      );
    }
    return profile?.emailVerified
      ? t("accountSettingsPage.emailVerified")
      : t("accountSettingsPage.emailHelp");
  }, [emailError, profile, t]);

  const showEmailInput = isChangingEmail || !profile?.email;

  return (
    <div className="mx-auto w-full max-w-[1024px] px-8 py-6">
      <EmailVerificationCodeModal
        open={isVerificationOpen}
        email={verificationEmail}
        sendsRemaining={profile?.emailVerificationSendsRemaining ?? 0}
        onClose={() => setIsVerificationOpen(false)}
        onVerify={onVerifyEmailCode}
        onResend={onResendEmailCode}
      />
      <ConfirmActionDialog
        open={isRemoveEmailConfirmOpen}
        title={t("accountSettingsPage.emailRemove")}
        description={t("accountSettingsPage.emailRemoveConfirm")}
        contextLabel={profile?.email ?? undefined}
        confirmLabel={t("accountSettingsPage.emailRemove")}
        tone="danger"
        loading={isSaving}
        onCancel={() => setIsRemoveEmailConfirmOpen(false)}
        onConfirm={onConfirmRemoveEmail}
      />
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
                  <span className="sr-only">
                    {t("accountSettingsPage.nameLabel")}
                  </span>
                  <XInput
                    id="account-settings-display-name"
                    value={form.displayName}
                    onChange={(event) =>
                      updateField("displayName", event.target.value)
                    }
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
                {profile?.email && !isChangingEmail ? (
                  <div className="rounded-[10px] border border-[#2f3336] bg-[#111418] px-3 py-2.5">
                    <p className="text-[13px] font-medium leading-5 text-white">
                      {profile.email}
                      {profile.emailVerified ? (
                        <span className="ml-2 rounded-full bg-[#0f3d2a] px-2 py-0.5 text-[11px] font-semibold text-[#7ff7be]">
                          {t("accountSettingsPage.emailVerifiedBadge")}
                        </span>
                      ) : null}
                    </p>
                  </div>
                ) : null}
                {showEmailInput ? (
                  <label className="block">
                    <span className="sr-only">
                      {t("accountSettingsPage.emailLabel")}
                    </span>
                    <XInput
                      id="account-settings-email"
                      value={form.email}
                      onChange={(event) =>
                        updateField("email", event.target.value)
                      }
                      placeholder={t("accountSettingsPage.emailPlaceholder")}
                      inputMode="email"
                      autoComplete="email"
                      className={INPUT_CLASSES}
                    />
                  </label>
                ) : null}
                <p
                  className={`text-[12px] leading-4 ${
                    emailError ? "text-[#ff8b8b]" : "text-[#71767b]"
                  }`}
                >
                  {emailStatusText}
                </p>
                <div className="flex flex-wrap gap-3">
                  {profile?.email && !isChangingEmail ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setIsChangingEmail(true);
                          updateField("email", profile.email ?? "");
                        }}
                        className="text-[12px] font-semibold leading-4 text-[#7ff7be] hover:text-[#a8ffd4]"
                      >
                        {t("accountSettingsPage.emailChange")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRemoveEmail()}
                        disabled={isSaving}
                        className="text-[12px] font-semibold leading-4 text-[#ff8b8b] hover:text-[#ffb1b1] disabled:opacity-45"
                      >
                        {t("accountSettingsPage.emailRemove")}
                      </button>
                    </>
                  ) : null}
                  {isChangingEmail && profile?.email ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForm(profileToForm(profile));
                        setIsChangingEmail(false);
                      }}
                      className="text-[12px] font-semibold leading-4 text-[#a7acb6] hover:text-white"
                    >
                      {t("accountSettingsPage.emailChangeCancelEdit")}
                    </button>
                  ) : null}
                </div>
                {profile?.pendingEmail ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setVerificationEmail(profile.pendingEmail ?? null);
                        setIsVerificationOpen(true);
                      }}
                      className="text-[12px] font-semibold leading-4 text-[#7ff7be] hover:text-[#a8ffd4]"
                    >
                      {t("accountSettingsPage.emailVerificationOpen")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onCancelPendingEmail()}
                      disabled={isSaving}
                      className="text-[12px] font-semibold leading-4 text-[#a7acb6] hover:text-white disabled:opacity-45"
                    >
                      {t("accountSettingsPage.emailPendingCancel")}
                    </button>
                  </div>
                ) : null}
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
                  description={t(
                    "accountSettingsPage.notifyMarketingDescription"
                  )}
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
                <CopyableValue
                  value={boundWallet}
                  displayValue={boundWallet ? maskWallet(boundWallet) : null}
                  label={t("accountSettingsPage.connectedWallet")}
                  valueClassName="text-[13px] font-medium leading-5 text-white"
                  emptyValue={t("accountSettingsPage.unset")}
                />
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
