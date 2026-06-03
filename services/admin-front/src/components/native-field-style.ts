import type { CSSProperties } from "react";

export const nativeFieldStyle: CSSProperties = {
  width: "100%",
  minHeight: "48px",
  padding: "0 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--input)",
  background: "var(--card)",
  color: "var(--foreground)",
  outline: "none",
  fontSize: "14px",
};

export const nativeTextAreaStyle: CSSProperties = {
  ...nativeFieldStyle,
  padding: "12px 14px",
  minHeight: "120px",
};
