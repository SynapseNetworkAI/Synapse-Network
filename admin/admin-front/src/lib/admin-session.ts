import type { AdminProfile } from "@/services/admin-api";

const TOKEN_KEY = "synapse.admin.token";
const PROFILE_KEY = "synapse.admin.profile";

export function readAdminToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(TOKEN_KEY);
}

export function readAdminProfile(): AdminProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as AdminProfile;
  } catch {
    clearAdminSession();
    return null;
  }
}

export function persistAdminSession(token: string, profile: AdminProfile): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearAdminSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(PROFILE_KEY);
}
