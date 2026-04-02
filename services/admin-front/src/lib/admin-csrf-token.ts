const STORAGE_KEY = "synapse.admin.csrfToken";

function hasSessionStorage(): boolean {
  return globalThis.window !== undefined;
}

export function saveAdminCsrfToken(token: string | null): void {
  if (!hasSessionStorage()) {
    return;
  }

  if (!token) {
    globalThis.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  globalThis.sessionStorage.setItem(STORAGE_KEY, token);
}

export function readAdminCsrfTokenFromStorage(): string | null {
  if (!hasSessionStorage()) {
    return null;
  }

  const token = globalThis.sessionStorage.getItem(STORAGE_KEY);
  return token && token.trim().length > 0 ? token : null;
}

export function clearAdminCsrfToken(): void {
  if (!hasSessionStorage()) {
    return;
  }

  globalThis.sessionStorage.removeItem(STORAGE_KEY);
}