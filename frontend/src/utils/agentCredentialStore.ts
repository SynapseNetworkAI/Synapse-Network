const STORAGE_KEY = "a2a_agent_credential_tokens";

type CredentialStoreMap = Record<string, string>;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStore(): CredentialStoreMap {
  if (!isBrowser()) return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as CredentialStoreMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(value: CredentialStoreMap): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function setCredentialForService(serviceId: string, token: string): void {
  const key = serviceId.trim().toUpperCase();
  if (!key) return;
  const current = readStore();
  current[key] = token;
  writeStore(current);
}

export function getCredentialForService(serviceId: string): string {
  const key = serviceId.trim().toUpperCase();
  if (!key) return "";
  const current = readStore();
  return current[key] || "";
}

export function removeCredentialForService(serviceId: string): void {
  const key = serviceId.trim().toUpperCase();
  if (!key) return;
  const current = readStore();
  delete current[key];
  writeStore(current);
}
