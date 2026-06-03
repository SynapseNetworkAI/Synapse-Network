"use client";

import { useEffect, useState } from "react";

import {
  getAdminMenuConfig,
  type AdminMenuConfigItem,
  type AdminMenuConfigMeta,
  type AdminMenuConfigResponse,
} from "@/services/admin-api";

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

    async function load() {
      try {
        const response = await getAdminMenuConfig(activeToken, {
          stage: "draft",
        });
        if (!cancelled) {
          applyResponse(response);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "加载菜单配置失败",
          );
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();
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
