"use client";

import { Box, Stack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  DataTable,
  EmptyBlock,
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
  ListPaginationBar,
  ListTableSurface,
  MessageBanner,
  StatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import { formatDateTime, inputText } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  listOwnerAccounts,
  type OwnerAccountItem,
  type OwnerAccountListResponse,
} from "@/services/admin-operations-api";

const STATUS_OPTIONS = [
  { value: "active", label: "active" },
  { value: "suspended", label: "suspended" },
  { value: "closed", label: "closed" },
];

type OwnerAccountParams = {
  q?: string;
  wallet?: string;
  email?: string;
  status?: string;
  page: number;
  pageSize: number;
};

type OwnerAccountFiltersProps = {
  query: string;
  wallet: string;
  email: string;
  status: string;
  onQueryChange: (value: string) => void;
  onWalletChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function OwnerAccountsWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const state = useOwnerAccountsState(token);

  if (loading || !admin || state.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="业务用户加载中"
        message="正在同步 owner account、钱包和邮箱验证状态..."
      />
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="运营查账"
      title="业务用户"
      description="查看 Consumer / Provider owner 的钱包、邮箱验证状态和运营关联摘要。完整邮箱默认隐藏，PII 查看必须走权限和审计。"
    >
      <Stack gap="16px">
        {state.error ? (
          <MessageBanner kind="error" message={state.error} />
        ) : null}
        <OwnerAccountsSurface state={state} />
      </Stack>
    </AdminShell>
  );
}

function useOwnerAccountsState(token: string | null) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [wallet, setWallet] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [payload, setPayload] = useState<OwnerAccountListResponse | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = useOwnerAccountParams({
    submittedQuery,
    wallet,
    email,
    status,
    page,
    pageSize,
  });
  useLoadOwnerAccounts(token, params, setPayload, setError, setBootstrapping);

  return {
    bootstrapping,
    email,
    error,
    page,
    pageSize,
    payload,
    query,
    setEmail,
    setPage,
    setPageSize,
    setQuery,
    setStatus,
    setSubmittedQuery,
    setWallet,
    status,
    wallet,
  };
}

function useOwnerAccountParams(input: {
  submittedQuery: string;
  wallet: string;
  email: string;
  status: string;
  page: number;
  pageSize: number;
}): OwnerAccountParams {
  return useMemo(
    () => ({
      q: input.submittedQuery || undefined,
      wallet: input.wallet.trim() || undefined,
      email: input.email.trim() || undefined,
      status: input.status === "all" ? undefined : input.status,
      page: input.page,
      pageSize: input.pageSize,
    }),
    [
      input.email,
      input.page,
      input.pageSize,
      input.status,
      input.submittedQuery,
      input.wallet,
    ]
  );
}

function useLoadOwnerAccounts(
  token: string | null,
  params: OwnerAccountParams,
  setPayload: (value: OwnerAccountListResponse) => void,
  setError: (value: string | null) => void,
  setBootstrapping: (value: boolean) => void
) {
  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void loadOwnerAccounts(
      token,
      params,
      cancelledState(() => cancelled, setPayload, setError, setBootstrapping)
    );
    return () => {
      cancelled = true;
    };
  }, [params, setBootstrapping, setError, setPayload, token]);
}

function cancelledState(
  isCancelled: () => boolean,
  setPayload: (value: OwnerAccountListResponse) => void,
  setError: (value: string | null) => void,
  setBootstrapping: (value: boolean) => void
) {
  return { isCancelled, setBootstrapping, setError, setPayload };
}

async function loadOwnerAccounts(
  token: string,
  params: OwnerAccountParams,
  state: ReturnType<typeof cancelledState>
) {
  try {
    state.setError(null);
    const result = await listOwnerAccounts(token, params);
    if (!state.isCancelled()) {
      state.setPayload(result);
    }
  } catch (loadError) {
    if (!state.isCancelled()) {
      state.setError(
        loadError instanceof Error ? loadError.message : "业务用户加载失败"
      );
    }
  } finally {
    if (!state.isCancelled()) {
      state.setBootstrapping(false);
    }
  }
}

function OwnerAccountsSurface({
  state,
}: {
  state: ReturnType<typeof useOwnerAccountsState>;
}) {
  const rows = state.payload?.items ?? [];
  const pagination = state.payload?.pagination;
  return (
    <ListTableSurface
      eyebrow="Owner Accounts"
      title="Consumer / Provider owner"
      description="这里是业务用户目录，不是后台管理员账号。先查 wallet / email / 状态，再进入资金明细排查。"
      stamp={`共 ${pagination?.total ?? 0} 个 owner`}
      filter={<OwnerAccountFilters state={state} />}
      table={<OwnerAccountsTable rows={rows} />}
      pagination={pagination ? <OwnerAccountPagination state={state} /> : null}
    />
  );
}

function OwnerAccountFilters({
  state,
}: {
  state: ReturnType<typeof useOwnerAccountsState>;
}) {
  const props: OwnerAccountFiltersProps = {
    email: state.email,
    onEmailChange: state.setEmail,
    onQueryChange: state.setQuery,
    onReset: () => resetFilters(state),
    onSearch: () => submitSearch(state),
    onStatusChange: (value) => {
      state.setStatus(value);
      state.setPage(1);
    },
    onWalletChange: state.setWallet,
    query: state.query,
    status: state.status,
    wallet: state.wallet,
  };
  return <OwnerAccountFilterForm {...props} />;
}

function OwnerAccountFilterForm(props: OwnerAccountFiltersProps) {
  return (
    <ListFilterForm
      onSubmit={props.onSearch}
      onReset={props.onReset}
      submitLabel="搜索 owner"
    >
      <ListFilterFields
        templateColumns={{ base: "1fr", xl: "1.5fr 1fr 1fr 0.8fr" }}
        fields={[
          ListFilterFieldPresets.keyword({
            value: props.query,
            onChange: props.onQueryChange,
            placeholder: "搜索钱包、account name 或邮箱",
          }),
          {
            key: "wallet",
            kind: "text",
            value: props.wallet,
            onChange: props.onWalletChange,
            placeholder: "Wallet",
          },
          {
            key: "email",
            kind: "text",
            value: props.email,
            onChange: props.onEmailChange,
            placeholder: "Masked/full email",
          },
          ListFilterFieldPresets.status({
            key: "status",
            value: props.status,
            onChange: props.onStatusChange,
            allLabel: "全部状态",
            options: STATUS_OPTIONS,
          }),
        ]}
      />
    </ListFilterForm>
  );
}

function OwnerAccountsTable({ rows }: { rows: OwnerAccountItem[] }) {
  if (rows.length === 0) {
    return (
      <EmptyBlock
        title="暂无业务用户"
        description="当前筛选条件下没有 owner account。"
      />
    );
  }
  return (
    <DataTable>
      <TableHeaderRow>
        <Th>Owner</Th>
        <Th>Email</Th>
        <Th>Role</Th>
        <Th>关联资源</Th>
        <Th>Status</Th>
        <Th>Last active</Th>
      </TableHeaderRow>
      <TableBody>
        {rows.map((owner) => (
          <OwnerAccountRow key={owner.ownerId} owner={owner} />
        ))}
      </TableBody>
    </DataTable>
  );
}

function OwnerAccountRow({ owner }: { owner: OwnerAccountItem }) {
  return (
    <Box as="tr">
      <Td>
        <Stack gap="4px">
          <Text fontWeight="800">{inputText(owner.accountName)}</Text>
          <Text color="ink.500" fontSize="13px">
            {owner.ownerWallet}
          </Text>
        </Stack>
      </Td>
      <Td>
        <Stack gap="4px">
          <Text fontWeight="700">{inputText(owner.email)}</Text>
          <Text
            color={owner.emailVerified ? "signal.700" : "ink.500"}
            fontSize="13px"
          >
            {owner.emailVerified ? "verified" : "not verified"}
          </Text>
          {owner.pendingEmail ? (
            <Text color="ink.500" fontSize="12px">
              pending: {owner.pendingEmail}
            </Text>
          ) : null}
        </Stack>
      </Td>
      <Td>{rolesLabel(owner)}</Td>
      <Td>
        <Text>{owner.agentCount} agents</Text>
        <Text color="ink.500">
          {owner.providerServiceCount} services · {owner.supportCaseCount}{" "}
          support
        </Text>
      </Td>
      <Td>
        <StatusChip value={owner.status} />
      </Td>
      <Td>{formatDateTime(owner.lastActiveAt ?? owner.updatedAt)}</Td>
    </Box>
  );
}

function OwnerAccountPagination({
  state,
}: {
  state: ReturnType<typeof useOwnerAccountsState>;
}) {
  const pagination = state.payload?.pagination;
  if (!pagination) {
    return null;
  }
  return (
    <ListPaginationBar
      pageSize={state.pageSize}
      pageSizeOptions={[20, 50, 100, 200]}
      totalPages={pagination.totalPages}
      totalCount={pagination.total}
      currentPage={state.page}
      canPrevious={pagination.hasPreviousPage}
      canNext={pagination.hasNextPage}
      onPageSizeChange={(next) => {
        state.setPageSize(next);
        state.setPage(1);
      }}
      onPrevious={() => state.setPage((current) => Math.max(1, current - 1))}
      onNext={() => state.setPage((current) => current + 1)}
    />
  );
}

function rolesLabel(owner: OwnerAccountItem): string {
  return owner.roles.length > 0 ? owner.roles.join(" / ") : "consumer";
}

function submitSearch(state: ReturnType<typeof useOwnerAccountsState>) {
  state.setPage(1);
  state.setSubmittedQuery(state.query.trim());
}

function resetFilters(state: ReturnType<typeof useOwnerAccountsState>) {
  state.setQuery("");
  state.setSubmittedQuery("");
  state.setWallet("");
  state.setEmail("");
  state.setStatus("all");
  state.setPage(1);
}
