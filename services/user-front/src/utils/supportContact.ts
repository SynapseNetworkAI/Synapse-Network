const DEFAULT_SUPPORT_SUBJECT = "Synapse support request";

export function getSupportEmail(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  return value ? value : null;
}

export function getSupportPortalUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL?.trim();
  return value ? value : null;
}

export function buildSupportMailto(subject?: string): string | null {
  const email = getSupportEmail();
  if (!email) {
    return null;
  }
  const nextSubject = encodeURIComponent(
    subject?.trim() || DEFAULT_SUPPORT_SUBJECT
  );
  return `mailto:${email}?subject=${nextSubject}`;
}

export function getSupportContactAvailable(): boolean {
  return Boolean(getSupportEmail() || getSupportPortalUrl());
}
