"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import {
  getAdminMenuConfig,
  type AdminMenuConfigItem,
  type AdminMenuConfigMeta,
  type AdminMenuConfigResponse,
} from "@/services/admin-api";

type DraftLoadHandlers = {
  applyResponse: (response: AdminMenuConfigResponse) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setBootstrapping: Dispatch<SetStateAction<boolean>>;
};

async function loadMenuConfigDraftSnapshot(
  activeToken: string,
  isCancelled: () => boolean,
  handlers: DraftLoadHandlers
) {
  try {
    const response = await getAdminMenuConfig(activeToken, { stage: "draft" });
    if (isCancelled()) {
      return;
    }
    handlers.applyResponse(response);
    handlers.setError(null);
  } catch (loadError) {
    if (isCancelled()) {
      return;
    }
    handlers.setError(
      loadError instanceof Error ? loadError.message : "加载菜单配置失败"
    );
  }
  if (isCancelled()) {
    return;
  }
  handlers.setBootstrapping(false);
}

export function useMenuConfigDraft(token: string | null) {
  const [rows, setRows] = useState<AdminMenuConfigItem[]>([]);
  const [meta, setMeta] = useState<AdminMenuConfigMeta | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  function applyResponse(response: AdminMenuConfigResponse) {
    setRows(response.items);
    setMeta(response.meta);
  }

  function clearNotices() {
    setMessage(null);
    setError(null);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    void loadMenuConfigDraftSnapshot(activeToken, () => cancelled, {
      applyResponse,
      setError,
      setBootstrapping,
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    rows,
    meta,
    message,
    error,
    bootstrapping,
    applyResponse,
    clearNotices,
    setMessage,
    setError,
  };
}
