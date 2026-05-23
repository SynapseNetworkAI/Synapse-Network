"use client";

import { Box, Button, Flex, Grid, Stack, Text } from "@chakra-ui/react";

import {
  DataTable,
  MessageBanner,
  MetricCard,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import type {
  ContractAddressRegistry,
  ContractRegistryCheck,
  ContractRegistryStatus,
} from "@/services/contract-addresses-api";

function statusTone(
  status: ContractRegistryStatus
): "green" | "orange" | "red" | "gray" {
  if (status === "critical") {
    return "red";
  }
  if (status === "warning") {
    return "orange";
  }
  return "green";
}

function shortAddress(address: string): string {
  if (!address || address === "unavailable") {
    return address || "not configured";
  }
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function displayMoney(value: string | null | undefined): string {
  if (!value) {
    return "unavailable";
  }
  return value;
}

function isVaultBelowLedger(registry: ContractAddressRegistry): boolean {
  const vault = Number(registry.balances.vaultUsdc);
  const obligation = Number(registry.balances.ledgerObligationUsdc ?? "NaN");
  return (
    Number.isFinite(vault) && Number.isFinite(obligation) && vault < obligation
  );
}

async function copyAddress(value: string): Promise<void> {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  await navigator.clipboard.writeText(value);
}

function AddressLine({
  address,
  explorerUrl,
}: Readonly<{ address: string; explorerUrl: string }>) {
  return (
    <Stack gap="6px">
      <Text fontFamily="mono" color="ink.900">
        {shortAddress(address)}
      </Text>
      <Flex gap="8px" wrap="wrap">
        <Button
          size="xs"
          borderRadius="full"
          variant="outline"
          onClick={() => void copyAddress(address)}
        >
          Copy
        </Button>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              alignItems: "center",
              border: "1px solid rgba(99,92,82,0.22)",
              borderRadius: "999px",
              color: "#2a2521",
              display: "inline-flex",
              fontSize: "12px",
              fontWeight: 700,
              minHeight: "24px",
              padding: "0 8px",
              textDecoration: "none",
            }}
          >
            Explorer
          </a>
        ) : null}
      </Flex>
    </Stack>
  );
}

function CheckRow({ check }: Readonly<{ check: ContractRegistryCheck }>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="800">{check.label}</Text>
      </Td>
      <Td>
        <Text fontFamily="mono">{shortAddress(check.expected)}</Text>
      </Td>
      <Td>
        <Text fontFamily="mono">{shortAddress(check.actual)}</Text>
      </Td>
      <Td>
        <SentinelStatusChip
          label={check.status}
          tone={statusTone(check.status)}
        />
      </Td>
    </Box>
  );
}

function ContractStatusBanners({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  const vaultBelowLedger = isVaultBelowLedger(registry);
  const criticalChecks = registry.contractChecks.filter(
    (check) => check.status === "critical"
  );

  return (
    <>
      {registry.network.rpcStatus === "degraded" ? (
        <MessageBanner
          kind="error"
          message="Chain read is degraded. The page is showing configured addresses and the latest available finance projection."
        />
      ) : null}
      {criticalChecks.length > 0 ? (
        <MessageBanner
          kind="error"
          message="One or more on-chain contract roles do not match the expected production registry."
        />
      ) : null}
      {vaultBelowLedger ? (
        <MessageBanner
          kind="error"
          message="Vault USDC is lower than the Gateway ledger obligation. Reconciliation needs immediate review."
        />
      ) : null}
    </>
  );
}

function NetworkMetricGrid({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
      <MetricCard
        label="Network"
        value={registry.network.chainName}
        meta={`chainId ${registry.network.chainId}`}
      />
      <MetricCard
        label="RPC status"
        value={registry.network.rpcStatus}
        meta={`block ${registry.network.latestBlock ?? "n/a"}`}
      />
      <MetricCard
        label="Vault USDC"
        value={displayMoney(registry.balances.vaultUsdc)}
        meta="SynapseCore token balance"
      />
      <MetricCard
        label="Platform fee pool"
        value={displayMoney(registry.balances.platformFeePoolUsdc)}
        meta="SynapseCore.platformFeePool()"
      />
    </Grid>
  );
}

function ContractRegistrySection({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <SurfaceCard
      eyebrow="Contract Registry"
      title="Production contracts"
      description="Read-only contract and token registry. Address changes stay in Terraform, Safe, Ledger, and deployment runbooks."
      stamp={registry.network.env}
    >
      <DataTable>
        <TableHeaderRow>
          <Th>Contract</Th>
          <Th>Address</Th>
          <Th>Status</Th>
        </TableHeaderRow>
        <TableBody>
          {registry.contracts.map((contract) => (
            <Box as="tr" key={contract.key}>
              <Td>
                <Text fontWeight="800">{contract.label}</Text>
                <Text color="ink.500">
                  expected: {shortAddress(contract.expectedAddress ?? "")}
                </Text>
              </Td>
              <Td>
                <AddressLine
                  address={contract.address}
                  explorerUrl={contract.explorerUrl}
                />
              </Td>
              <Td>
                <SentinelStatusChip
                  label={contract.status}
                  tone={statusTone(contract.status)}
                />
              </Td>
            </Box>
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function ContractChecksSection({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <SurfaceCard
      eyebrow="On-chain Contract Checks"
      title="Expected vs actual"
      description="These checks read SynapseCore directly. Any owner, signer, or USDC mismatch is critical."
      stamp={formatDateTime(registry.network.checkedAt)}
    >
      <DataTable>
        <TableHeaderRow>
          <Th>Check</Th>
          <Th>Expected</Th>
          <Th>Actual</Th>
          <Th>Status</Th>
        </TableHeaderRow>
        <TableBody>
          {registry.contractChecks.map((check) => (
            <CheckRow key={check.key} check={check} />
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function CustodyAddressBookSection({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <SurfaceCard
      eyebrow="Custody Address Book"
      title="Operational wallets"
      description="Public address registry for Safe ownership, Ledger deployment, KMS withdrawal signing, vault custody, and USDC settlement."
    >
      <DataTable>
        <TableHeaderRow>
          <Th>Role</Th>
          <Th>Purpose</Th>
          <Th>Address</Th>
          <Th>ETH</Th>
          <Th>USDC</Th>
          <Th>Status</Th>
        </TableHeaderRow>
        <TableBody>
          {registry.roles.map((role) => (
            <Box as="tr" key={role.key}>
              <Td>
                <Text fontWeight="800">{role.label}</Text>
                <Text color="ink.500">source: {role.source}</Text>
              </Td>
              <Td>{role.purpose}</Td>
              <Td>
                <AddressLine
                  address={role.address}
                  explorerUrl={role.explorerUrl}
                />
              </Td>
              <Td>{displayMoney(role.nativeBalance)}</Td>
              <Td>{displayMoney(role.usdcBalance)}</Td>
              <Td>
                <SentinelStatusChip
                  label={role.status}
                  tone={statusTone(role.status)}
                />
              </Td>
            </Box>
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function BalanceAndFeeSections({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
      <BalanceSection registry={registry} />
      <PlatformFeeSection registry={registry} />
    </Grid>
  );
}

function BalanceSection({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <SurfaceCard
      eyebrow="Balances"
      title="Vault and custody balances"
      description="Amounts are read from chain and Gateway finance projections. This page does not initiate transfers."
    >
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
        <MetricCard
          label="SynapseCore USDC"
          value={displayMoney(registry.balances.vaultUsdc)}
          meta="Vault token balance"
        />
        <MetricCard
          label="SynapseCore ETH"
          value={displayMoney(registry.balances.vaultNative)}
          meta="Vault native balance"
        />
        <MetricCard
          label="Treasury Safe USDC"
          value={displayMoney(registry.balances.treasurySafeUsdc)}
          meta="Safe token balance"
        />
        <MetricCard
          label="Treasury Safe ETH"
          value={displayMoney(registry.balances.treasurySafeNative)}
          meta="Safe gas balance"
        />
      </Grid>
    </SurfaceCard>
  );
}

function PlatformFeeSection({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <SurfaceCard
      eyebrow="Platform Fees & Reconciliation"
      title="Fee pool and ledger exposure"
      description="Vault-ledger delta and fee balances come from backend-owned finance projections."
    >
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="12px">
        <MetricCard
          label="Ledger platform fee"
          value={displayMoney(registry.balances.ledgerPlatformFeeUsdc)}
          meta="Gateway platform fee balance"
        />
        <MetricCard
          label="Ledger obligation"
          value={displayMoney(registry.balances.ledgerObligationUsdc)}
          meta="Gateway liability projection"
        />
        <MetricCard
          label="Vault-ledger delta"
          value={displayMoney(registry.balances.vaultLedgerDeltaUsdc)}
          meta="Reconciliation delta"
        />
        <MetricCard
          label="Today fee earned"
          value={displayMoney(registry.feeSummary.todayPlatformFeeUsdc)}
          meta="Today's platform fee"
        />
        <MetricCard
          label="7d fee earned"
          value={displayMoney(registry.feeSummary.sevenDayPlatformFeeUsdc)}
          meta="Seven day platform fee"
        />
        <MetricCard
          label="30d fee earned"
          value={displayMoney(registry.feeSummary.thirtyDayPlatformFeeUsdc)}
          meta="Thirty day platform fee"
        />
      </Grid>
    </SurfaceCard>
  );
}

function ReadOnlyBoundarySection() {
  return (
    <SurfaceCard
      eyebrow="Read-only Boundary"
      title="No operational actions here"
      description="This page is visibility only. Address updates stay in Terraform and custody runbooks; on-chain execution stays in Safe and Ledger tools."
    >
      <Text color="ink.500">
        Use this surface as the production source of visibility, not as a
        custody tool.
      </Text>
    </SurfaceCard>
  );
}

export function ContractAddressesWorkspace({
  registry,
}: Readonly<{ registry: ContractAddressRegistry }>) {
  return (
    <Stack gap="18px">
      <ContractStatusBanners registry={registry} />
      <NetworkMetricGrid registry={registry} />
      <ContractRegistrySection registry={registry} />
      <ContractChecksSection registry={registry} />
      <CustodyAddressBookSection registry={registry} />
      <BalanceAndFeeSections registry={registry} />
      <ReadOnlyBoundarySection />
    </Stack>
  );
}
