"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { ContractAddressesWorkspace } from "@/features/contract-addresses/contract-addresses-page";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  getContractAddressRegistry,
  type ContractAddressRegistry,
} from "@/services/contract-addresses-api";

export default function ContractAddressesPage() {
  const { admin, token, loading } = useAdminSession();
  const { bootstrapping, error, registry } = useContractAddressRegistry(token);

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Contract registry loading"
        message="Reading contract addresses and custody balances..."
      />
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Production Contract Registry"
      title="合约 / 地址"
      description="只读查看生产合约、Safe、Ledger、KMS signer、Vault 余额和平台 fee 对账状态。"
    >
      {registry ? (
        <ContractAddressesWorkspace registry={registry} />
      ) : (
        <MessageBanner
          kind="error"
          message={error ?? "Contract registry is temporarily unavailable."}
        />
      )}
    </AdminShell>
  );
}

function useContractAddressRegistry(token: string | null) {
  const [registry, setRegistry] = useState<ContractAddressRegistry | null>(
    null
  );
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    const loadState = { cancelled: false };
    setBootstrapping(true);
    setError(null);
    void getContractAddressRegistry(token)
      .then((result) => commitRegistryResult(loadState, setRegistry, result))
      .catch((loadError) => commitRegistryError(loadState, setError, loadError))
      .finally(() => commitRegistrySettled(loadState, setBootstrapping));
    return () => {
      loadState.cancelled = true;
    };
  }, [token]);

  return { bootstrapping, error, registry };
}

function commitRegistryResult(
  state: { cancelled: boolean },
  setRegistry: (registry: ContractAddressRegistry) => void,
  registry: ContractAddressRegistry
) {
  if (state.cancelled) return;
  setRegistry(registry);
}

function commitRegistryError(
  state: { cancelled: boolean },
  setError: (message: string) => void,
  loadError: unknown
) {
  if (state.cancelled) return;
  setError(
    loadError instanceof Error
      ? loadError.message
      : "Contract registry is temporarily unavailable."
  );
}

function commitRegistrySettled(
  state: { cancelled: boolean },
  setBootstrapping: (value: boolean) => void
) {
  if (state.cancelled) return;
  setBootstrapping(false);
}
