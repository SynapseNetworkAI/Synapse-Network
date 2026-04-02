export function normalizeOtpCode(value: string, length = 6): string {
  return value.replaceAll(/\D/g, "").slice(0, length);
}

export function getOtpSlots(value: string, length = 6): string[] {
  const normalized = normalizeOtpCode(value, length);
  return Array.from({ length }, (_, index) => normalized[index] ?? "");
}

export function applyOtpSlotEdit(currentValue: string, index: number, rawValue: string, length = 6): string {
  const digits = normalizeOtpCode(rawValue, length);
  const slots = getOtpSlots(currentValue, length);

  if (!digits) {
    slots[index] = "";
    return normalizeOtpCode(slots.join(""), length);
  }

  digits.split("").forEach((digit, offset) => {
    const nextIndex = index + offset;
    if (nextIndex < length) {
      slots[nextIndex] = digit;
    }
  });

  return normalizeOtpCode(slots.join(""), length);
}