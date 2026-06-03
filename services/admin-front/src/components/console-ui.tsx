"use client";

import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import Link from "next/link";

import { toneFromStatus, toneStyles } from "@/lib/admin-console";

import { InlineHintTooltip } from "./inline-hint-tooltip";
import { nativeFieldStyle } from "./native-field-style";
export { InlineHintTooltip } from "./inline-hint-tooltip";
export { nativeFieldStyle, nativeTextAreaStyle } from "./native-field-style";

export function SurfaceCard({
  eyebrow,
  title,
  description,
  stamp,
  actions,
  children,
}: Readonly<{
  eyebrow?: string;
  title?: string;
  description?: string;
  stamp?: string;
  actions?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <Box
      bg="shadcn.card"
      border="1px solid"
      borderColor="shadcn.border"
      borderRadius="lg"
      boxShadow="panel"
      p={{ base: "20px", md: "24px" }}
      data-testid={title ? `admin-surface-${title}` : undefined}
    >
      {eyebrow || title || description || stamp || actions ? (
        <Box mb="18px">
          <Stack
            direction={{ base: "column", lg: "row" }}
            justify="space-between"
            align={{ base: "flex-start", lg: "center" }}
            gap="16px"
          >
            <Stack gap="4px">
              {eyebrow ? (
                <Text
                  fontSize="11px"
                  letterSpacing="0.22em"
                  textTransform="uppercase"
                  color="shadcn.accentForeground"
                >
                  {eyebrow}
                </Text>
              ) : null}
              {title ? (
                <Heading
                  size="md"
                  color="shadcn.foreground"
                  letterSpacing="-0.02em"
                >
                  {title}
                </Heading>
              ) : null}
              {description ? (
                <Text color="shadcn.mutedForeground" maxW="3xl">
                  {description}
                </Text>
              ) : null}
            </Stack>
            <Stack
              direction={{ base: "column", md: "row" }}
              gap="10px"
              align={{ base: "stretch", md: "center" }}
            >
              {stamp ? (
                <Badge
                  borderRadius="full"
                  px="12px"
                  py="6px"
                  bg="shadcn.accent"
                  color="shadcn.accentForeground"
                  border="1px solid"
                  borderColor="shadcn.border"
                >
                  {stamp}
                </Badge>
              ) : null}
              {actions}
            </Stack>
          </Stack>
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

export function MetricCard({
  label,
  value,
  meta,
  accent,
  href,
  actionLabel,
}: Readonly<{
  label: ReactNode;
  value: string | number;
  meta?: ReactNode;
  accent?: string;
  href?: string;
  actionLabel?: string;
}>) {
  const card = (
    <Box
      borderRadius="lg"
      p="18px"
      bg={
        accent ??
        "linear-gradient(180deg, var(--card) 0%, var(--console-panel) 100%)"
      }
      border="1px solid"
      borderColor="shadcn.border"
      minH="154px"
      overflow="visible"
      position="relative"
      transition="transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease"
      _hover={
        href
          ? {
              transform: "translateY(-2px)",
              boxShadow: "panelSoft",
              borderColor: "shadcn.ring",
            }
          : undefined
      }
    >
      <Box
        position="absolute"
        inset="0"
        overflow="hidden"
        borderRadius="inherit"
        pointerEvents="none"
      >
        <Box
          position="absolute"
          right="-20px"
          top="-24px"
          w="96px"
          h="96px"
          borderRadius="full"
          bg="var(--accent-soft)"
        />
      </Box>
      <Box
        position="relative"
        zIndex={1}
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="shadcn.mutedForeground"
      >
        {label}
      </Box>
      <Heading
        position="relative"
        zIndex={1}
        mt="18px"
        size="2xl"
        color="shadcn.foreground"
        letterSpacing="-0.04em"
      >
        {value}
      </Heading>
      {meta ? (
        <Text
          position="relative"
          zIndex={1}
          mt="10px"
          color="shadcn.mutedForeground"
        >
          {meta}
        </Text>
      ) : null}
      {href ? (
        <Text
          position="relative"
          zIndex={1}
          mt="12px"
          fontWeight="700"
          color="shadcn.accentForeground"
        >
          {actionLabel ?? "查看明细"}
        </Text>
      ) : null}
    </Box>
  );

  if (!href) {
    return card;
  }

  return (
    <Link href={href} style={{ display: "block", textDecoration: "none" }}>
      {card}
    </Link>
  );
}

export function MetricLabelWithHint({
  label,
  hint,
}: Readonly<{
  label: string;
  hint: string;
}>) {
  return (
    <Flex align="center" gap="8px" wrap="wrap">
      <Text
        fontSize="inherit"
        letterSpacing="inherit"
        textTransform="inherit"
        color="inherit"
      >
        {label}
      </Text>
      <InlineHintTooltip label={`${label} tip`} content={hint} />
    </Flex>
  );
}

export function StatusChip({
  value,
}: Readonly<{ value: string | null | undefined }>) {
  const styles = toneStyles(toneFromStatus(value));
  return (
    <Badge
      borderRadius="full"
      px="10px"
      py="6px"
      border="1px solid"
      fontWeight="700"
      letterSpacing="0.08em"
      textTransform="uppercase"
      {...styles}
    >
      {value ?? "unknown"}
    </Badge>
  );
}

export function SentinelStatusChip({
  label,
  tone,
}: Readonly<{ label: string; tone: "green" | "orange" | "red" | "gray" }>) {
  return (
    <Badge
      borderRadius="full"
      px="10px"
      py="6px"
      border="1px solid"
      fontWeight="700"
      letterSpacing="0.08em"
      textTransform="uppercase"
      {...toneStyles(tone)}
    >
      {label}
    </Badge>
  );
}

export function MessageBanner({
  kind,
  message,
}: Readonly<{ kind: "error" | "success"; message: string }>) {
  const styles =
    kind === "error"
      ? {
          bg: "rgba(184, 49, 49, 0.10)",
          color: "#7d1e1e",
          borderColor: "rgba(184, 49, 49, 0.16)",
        }
      : {
          bg: "rgba(31, 146, 87, 0.10)",
          color: "#145638",
          borderColor: "rgba(31, 146, 87, 0.16)",
        };
  return (
    <Box borderRadius="18px" border="1px solid" p="14px 16px" {...styles}>
      <Text fontWeight="600">{message}</Text>
    </Box>
  );
}

export function OverlayPanel({
  open,
  title,
  description,
  children,
  onClose,
  footer,
}: Readonly<{
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}>) {
  if (!open) {
    return null;
  }
  return (
    <Box
      position="fixed"
      inset="0"
      zIndex={40}
      display="grid"
      placeItems="center"
      px={{ base: "14px", md: "24px" }}
      py={{ base: "18px", md: "32px" }}
    >
      <Box
        position="absolute"
        inset="0"
        bg="rgba(20,19,17,0.58)"
        backdropFilter="blur(8px)"
        onClick={onClose}
      />
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={title}
        position="relative"
        w="min(760px, 100%)"
        maxH="min(86vh, 920px)"
        bg="#f7f2ea"
        border="1px solid rgba(99,92,82,0.12)"
        borderRadius={{ base: "24px", md: "32px" }}
        boxShadow="0 32px 90px rgba(20,19,17,0.26)"
        p={{ base: "18px", md: "28px" }}
        overflowY="auto"
      >
        <Stack gap="16px">
          <Stack
            direction={{ base: "column", md: "row" }}
            justify="space-between"
            align={{ base: "flex-start", md: "flex-start" }}
          >
            <Stack gap="4px">
              <Text
                fontSize="11px"
                letterSpacing="0.2em"
                textTransform="uppercase"
                color="brand.600"
              >
                Action Modal
              </Text>
              <Heading size="lg">{title}</Heading>
              <Text color="ink.500">{description}</Text>
            </Stack>
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </Stack>
          {children}
          {footer ? <Box>{footer}</Box> : null}
        </Stack>
      </Box>
    </Box>
  );
}

export function FieldBlock({
  label,
  hint,
  children,
}: Readonly<{ label: string; hint?: string; children: ReactNode }>) {
  return (
    <Stack gap="8px">
      <Text
        fontSize="12px"
        fontWeight="700"
        color="ink.700"
        textTransform="uppercase"
        letterSpacing="0.12em"
      >
        {label}
      </Text>
      {children}
      {hint ? (
        <Text color="ink.500" fontSize="13px">
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}

export function SearchInput(
  props: Readonly<{
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }>
) {
  return (
    <Input
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      bg="rgba(255,255,255,0.85)"
      borderRadius="16px"
      borderColor="rgba(99,92,82,0.16)"
      _focusVisible={{
        borderColor: "brand.400",
        boxShadow: "0 0 0 3px rgba(243,106,29,0.16)",
      }}
    />
  );
}

type ListFilterFieldOption = {
  label: string;
  value: string;
};

type ListFilterSearchField = {
  key: string;
  kind: "search";
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

type ListFilterTextField = {
  key: string;
  kind: "text";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  listId?: string;
  listOptions?: string[];
};

type ListFilterSelectField = {
  key: string;
  kind: "select";
  value: string;
  onChange: (value: string) => void;
  options: ListFilterFieldOption[];
};

type ListFilterDateField = {
  key: string;
  kind: "date";
  value: string;
  onChange: (value: string) => void;
};

type ListFilterCustomField = {
  key: string;
  kind: "custom";
  node: ReactNode;
};

export type ListFilterFieldConfig =
  | ListFilterSearchField
  | ListFilterTextField
  | ListFilterSelectField
  | ListFilterDateField
  | ListFilterCustomField;

export const ListFilterFieldPresets = {
  keyword({
    key = "query",
    value,
    onChange,
    placeholder,
  }: Readonly<{
    key?: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }>): ListFilterFieldConfig {
    return {
      key,
      kind: "search",
      value,
      onChange,
      placeholder,
    };
  },
  status({
    key,
    value,
    onChange,
    allLabel,
    options,
  }: Readonly<{
    key: string;
    value: string;
    onChange: (value: string) => void;
    allLabel: string;
    options: ListFilterFieldOption[];
  }>): ListFilterFieldConfig {
    return {
      key,
      kind: "select",
      value,
      onChange,
      options: [{ value: "all", label: allLabel }, ...options],
    };
  },
  dateRange({
    startKey,
    startValue,
    onStartChange,
    endKey,
    endValue,
    onEndChange,
  }: Readonly<{
    startKey: string;
    startValue: string;
    onStartChange: (value: string) => void;
    endKey: string;
    endValue: string;
    onEndChange: (value: string) => void;
  }>): ListFilterFieldConfig[] {
    return [
      {
        key: startKey,
        kind: "date",
        value: startValue,
        onChange: onStartChange,
      },
      {
        key: endKey,
        kind: "date",
        value: endValue,
        onChange: onEndChange,
      },
    ];
  },
};

export function ListFilterFields({
  fields,
  templateColumns,
  gap = "12px",
  marginBottom = "12px",
}: Readonly<{
  fields: ListFilterFieldConfig[];
  templateColumns: Record<string, string> | string;
  gap?: string;
  marginBottom?: string;
}>) {
  return (
    <Grid templateColumns={templateColumns} gap={gap} mb={marginBottom}>
      {fields.map((field) => {
        if (field.kind === "search") {
          return (
            <SearchInput
              key={field.key}
              value={field.value}
              onChange={field.onChange}
              placeholder={field.placeholder}
            />
          );
        }

        if (field.kind === "text") {
          return (
            <Box key={field.key}>
              <Input
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                placeholder={field.placeholder}
                bg="rgba(255,255,255,0.85)"
                borderRadius="16px"
                borderColor="rgba(99,92,82,0.16)"
                _focusVisible={{
                  borderColor: "brand.400",
                  boxShadow: "0 0 0 3px rgba(243,106,29,0.16)",
                }}
                list={field.listId}
              />
              {field.listId && field.listOptions ? (
                <datalist id={field.listId}>
                  {field.listOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              ) : null}
            </Box>
          );
        }

        if (field.kind === "select") {
          return (
            <select
              key={field.key}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              style={nativeFieldStyle}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          );
        }

        if (field.kind === "date") {
          return (
            <input
              key={field.key}
              type="date"
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              style={nativeFieldStyle}
            />
          );
        }

        return <Box key={field.key}>{field.node}</Box>;
      })}
    </Grid>
  );
}

export function ListFilterForm({
  children,
  onSubmit,
  onReset,
  loading,
  submitLabel = "搜索",
  resetLabel = "重置筛选",
  helperText,
}: Readonly<{
  children: ReactNode;
  onSubmit: () => void;
  onReset?: () => void;
  loading?: boolean;
  submitLabel?: string;
  resetLabel?: string;
  helperText?: ReactNode;
}>) {
  return (
    <Box
      as="form"
      onSubmit={(event: React.FormEvent<HTMLDivElement>) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Stack gap="12px">
        <Box>{children}</Box>
        <Stack
          direction={{ base: "column", lg: "row" }}
          justify="space-between"
          align={{ base: "stretch", lg: "center" }}
          gap="12px"
        >
          <Stack
            direction={{ base: "column", md: "row" }}
            gap="12px"
            flexShrink={0}
          >
            <Button
              size="md"
              borderRadius="16px"
              type="submit"
              loading={loading}
            >
              {submitLabel}
            </Button>
            {onReset ? (
              <Button
                size="md"
                borderRadius="16px"
                variant="ghost"
                type="button"
                onClick={onReset}
                disabled={loading}
              >
                {resetLabel}
              </Button>
            ) : null}
          </Stack>
          {helperText ? <Text color="ink.500">{helperText}</Text> : null}
        </Stack>
      </Stack>
    </Box>
  );
}

export function ListTableSurface({
  eyebrow,
  title,
  description,
  stamp,
  actions,
  filter,
  table,
  pagination,
}: Readonly<{
  eyebrow?: string;
  title?: string;
  description?: string;
  stamp?: string;
  actions?: ReactNode;
  filter: ReactNode;
  table: ReactNode;
  pagination?: ReactNode;
}>) {
  return (
    <SurfaceCard
      eyebrow={eyebrow}
      title={title}
      description={description}
      stamp={stamp}
      actions={actions}
    >
      <Stack gap="16px">
        <Box>{filter}</Box>
        <Box>{table}</Box>
        {pagination ? <Box>{pagination}</Box> : null}
      </Stack>
    </SurfaceCard>
  );
}

export function DataTable({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      overflowX="auto"
      borderRadius="22px"
      border="1px solid rgba(15,17,21,0.06)"
      bg="rgba(255,255,255,0.96)"
    >
      <Box
        as="table"
        w="100%"
        fontSize="14px"
        style={{ borderCollapse: "collapse" }}
      >
        {children}
      </Box>
    </Box>
  );
}

export function TableHeaderRow({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      as="thead"
      bg="#f4f7fb"
      color="ink.500"
      textTransform="uppercase"
      letterSpacing="0.12em"
      fontSize="11px"
    >
      <Box as="tr">{children}</Box>
    </Box>
  );
}

export function TableBody({ children }: Readonly<{ children: ReactNode }>) {
  return <Box as="tbody">{children}</Box>;
}

export function Th({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box as="th" textAlign="left" px="16px" py="14px" fontWeight="700">
      {children}
    </Box>
  );
}

export function Td({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      as="td"
      px="16px"
      py="14px"
      borderTop="1px solid rgba(99,92,82,0.08)"
      verticalAlign="top"
    >
      {children}
    </Box>
  );
}

export function EmptyBlock({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <Grid placeItems="center" minH="180px" textAlign="center" p="24px">
      <Stack gap="6px" maxW="lg">
        <Heading size="md">{title}</Heading>
        <Text color="ink.500">{description}</Text>
      </Stack>
    </Grid>
  );
}

export function ListPaginationBar({
  pageSize,
  pageSizeOptions,
  totalPages,
  totalCount,
  currentPage,
  loading,
  canPrevious,
  canNext,
  onPageSizeChange,
  onPrevious,
  onNext,
}: Readonly<{
  pageSize: number;
  pageSizeOptions: number[];
  totalPages: number;
  totalCount?: number;
  currentPage: number;
  loading?: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPageSizeChange: (pageSize: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <Grid
      templateColumns={{ base: "1fr", lg: "180px minmax(0, 1fr) auto" }}
      gap="12px"
      alignItems="center"
    >
      <select
        value={String(pageSize)}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        style={nativeFieldStyle}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>{`每页 ${option} 条`}</option>
        ))}
      </select>
      <Stack
        gap="2px"
        justify="center"
        textAlign={{ base: "left", lg: "center" }}
      >
        <Text
          fontSize="12px"
          fontWeight="700"
          letterSpacing="0.12em"
          textTransform="uppercase"
          color="ink.500"
        >
          分页信息
        </Text>
        <Text color="ink.700">
          第 {currentPage} / {totalPages} 页
          {typeof totalCount === "number" ? ` · 共 ${totalCount} 条` : ""}
        </Text>
      </Stack>
      <Stack
        direction="row"
        justify={{ base: "flex-start", lg: "flex-end" }}
        gap="10px"
      >
        <Button
          variant="ghost"
          borderRadius="16px"
          onClick={onPrevious}
          disabled={!canPrevious || loading}
        >
          上一页
        </Button>
        <Button
          variant="ghost"
          borderRadius="16px"
          onClick={onNext}
          disabled={!canNext || loading}
        >
          下一页
        </Button>
      </Stack>
    </Grid>
  );
}
