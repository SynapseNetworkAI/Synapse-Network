"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listAdminPermissions,
  listAdminRoles,
  type AdminPermissionCatalogItem,
  type AdminRoleCatalogItem,
} from "@/services/admin-api";

export function useRolePermissionsData(token: string | null) {
  const [roles, setRoles] = useState<AdminRoleCatalogItem[]>([]);
  const [permissions, setPermissions] = useState<AdminPermissionCatalogItem[]>(
    []
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const loadData = useCallback(
    async (activeToken = token) => {
      if (!activeToken) {
        return;
      }
      const [roleResponse, permissionResponse] = await Promise.all([
        listAdminRoles(activeToken),
        listAdminPermissions(activeToken),
      ]);
      setRoles(roleResponse.items);
      setPermissions(permissionResponse.items);
    },
    [token]
  );

  function clearNotices() {
    setError(null);
    setMessage(null);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        await loadData(activeToken);
        if (!cancelled) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "加载角色权限矩阵失败"
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
  }, [loadData, token]);

  return {
    roles,
    permissions,
    error,
    message,
    bootstrapping,
    loadData,
    clearNotices,
    setError,
    setMessage,
  };
}
