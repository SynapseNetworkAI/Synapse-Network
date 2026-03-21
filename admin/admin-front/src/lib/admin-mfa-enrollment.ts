import type { MfaEnrollmentRequiredData } from "@/services/admin-api";

const STORAGE_KEY = "synapse.admin.mfaEnrollment";

export type PendingMfaEnrollment = MfaEnrollmentRequiredData & {
  createdAt: number;
};

function hasSessionStorage(): boolean {
  return globalThis.window !== undefined;
}

export function savePendingMfaEnrollment(payload: MfaEnrollmentRequiredData): void {
  if (!hasSessionStorage()) {
    return;
  }

  const value: PendingMfaEnrollment = {
    ...payload,
    createdAt: Date.now(),
  };
  globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function readPendingMfaEnrollment(): PendingMfaEnrollment | null {
  if (!hasSessionStorage()) {
    return null;
  }

  const raw = globalThis.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PendingMfaEnrollment;
    if (!parsed.enrollmentToken || !parsed.expiresIn) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingMfaEnrollment(): void {
  if (!hasSessionStorage()) {
    return;
  }

  globalThis.sessionStorage.removeItem(STORAGE_KEY);
}