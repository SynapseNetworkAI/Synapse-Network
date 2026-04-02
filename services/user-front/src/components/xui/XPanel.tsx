"use client";

import type { ElementType, HTMLAttributes } from "react";
import { cx } from "@/components/xui/cx";

type XPanelVariant = "flat" | "muted" | "tile" | "tileInteractive" | "tileActive";

const VARIANT_CLASSES: Record<XPanelVariant, string> = {
  flat: "x-panel-flat",
  muted: "x-panel-muted",
  tile: "x-tile-flat",
  tileInteractive: "x-tile-flat x-tile-flat-hover",
  tileActive: "x-tile-active",
};

type XPanelProps<T extends ElementType> = {
  as?: T;
  variant?: XPanelVariant;
} & Omit<HTMLAttributes<HTMLElement>, "as">;

export function XPanel<T extends ElementType = "div">({
  as,
  variant = "flat",
  className,
  ...props
}: Readonly<XPanelProps<T>>) {
  const Component = as ?? "div";
  return <Component className={cx(VARIANT_CLASSES[variant], className)} {...props} />;
}
