const DEFAULT_SUPPORT_SUBJECT = "Synapse support request";

function readPublicEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getSupportEmail(): string | null {
  return readPublicEnv("NEXT_PUBLIC_SUPPORT_EMAIL");
}

export function getSupportPortalUrl(): string | null {
  return readPublicEnv("NEXT_PUBLIC_SUPPORT_PORTAL_URL");
}

export function buildSupportMailto(subject?: string): string | null {
  const email = getSupportEmail();
  if (!email) {
    return null;
  }
  const nextSubject = encodeURIComponent(subject?.trim() || DEFAULT_SUPPORT_SUBJECT);
  return `mailto:${email}?subject=${nextSubject}`;
}

export function getSupportContactAvailable(): boolean {
  return Boolean(getSupportEmail() || getSupportPortalUrl());
}
