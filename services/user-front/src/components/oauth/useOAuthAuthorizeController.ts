"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { oauthAuthorizeCopy as copy } from "@/components/oauth/oauthAuthorizeCopy";
import type { OAuthParams } from "@/components/oauth/oauthAuthorizeTypes";
import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";
import {
  approveOAuthAuthorization,
  issueChatGptMcpCredential,
  listOAuthAgentCredentials,
} from "@/utils/oauthApi";

export function useOAuthAuthorizeController(
  address: string | undefined,
  isSessionAuthenticated: boolean
) {
  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCredentials = useCallback(async () => {
    if (!address || !isSessionAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const rows = await listOAuthAgentCredentials(address);
      setCredentials(rows);
      setSelectedCredentialId((current) => current || rows[0]?.id || "");
    } catch (loadError) {
      setError(errorMessage(loadError, copy.loadFailed));
    } finally {
      setIsLoading(false);
    }
  }, [address, isSessionAuthenticated]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const createCredential = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    setError(null);
    try {
      const credential = await issueChatGptMcpCredential(address);
      setCredentials((current) => [credential, ...current]);
      setSelectedCredentialId(credential.id);
      toast.success(copy.credentialCreated);
    } catch (createError) {
      showError(createError, copy.createFailed, setError);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  const approve = useCallback(
    async (oauthParams: OAuthParams) => {
      if (!address || !selectedCredentialId) return;
      setIsApproving(true);
      setError(null);
      try {
        window.location.href = await approveOAuthAuthorization(address, {
          ...oauthParams,
          credentialId: selectedCredentialId,
        });
      } catch (approveError) {
        showError(approveError, copy.approveFailed, setError);
      } finally {
        setIsApproving(false);
      }
    },
    [address, selectedCredentialId]
  );

  return {
    credentials,
    selectedCredentialId,
    setSelectedCredentialId,
    isLoading,
    isApproving,
    error,
    createCredential,
    approve,
  };
}

function showError(
  value: unknown,
  fallback: string,
  setError: (message: string) => void
) {
  const message = errorMessage(value, fallback);
  setError(message);
  toast.error(message);
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}
