"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  createAdminUser,
  deleteAdminUser,
  listAdminRoles,
  listAdminUsers,
  updateAdminUser,
  type AdminRoleCatalogItem,
  type AdminUserItem,
} from "@/services/admin-api";

import {
  buildAdminUserCreateInput,
  buildAdminUserMetrics,
  buildAdminUserUpdateInput,
  buildRoleSnapshots,
  buildUserEditForm,
  buildUserMutationError,
  createEmptyUserForm,
  filterAdminUsers,
  type UserFormState,
} from "./user-presenters";

export function useAdminUsers(token: string | null) {
  const directory = useAdminUserDirectory(token);
  const filters = useAdminUserFilters(directory.users);
  const editor = useAdminUserEditor({
    refresh: directory.refresh,
    roles: directory.roles,
    setError: directory.setError,
    setNotice: directory.setNotice,
    token,
  });
  const deletion = useAdminUserDeletion({
    refresh: directory.refresh,
    setError: directory.setError,
    setNotice: directory.setNotice,
    token,
  });

  return {
    ...directory,
    ...filters,
    ...editor,
    ...deletion,
    metrics: useMemo(
      () => buildAdminUserMetrics(directory.users),
      [directory.users]
    ),
    roleSnapshots: useMemo(
      () => buildRoleSnapshots(directory.users, directory.roles),
      [directory.roles, directory.users]
    ),
  };
}

function useAdminUserDirectory(token: string | null) {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [roles, setRoles] = useState<AdminRoleCatalogItem[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    if (!token) {
      return;
    }
    const [userResponse, roleResponse] = await Promise.all([
      listAdminUsers(token),
      listAdminRoles(token),
    ]);
    setUsers(userResponse.items);
    setRoles(roleResponse.items);
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    const activeToken = token;
    let cancelled = false;
    void loadAdminUserDirectoryEffect({
      isCancelled: () => cancelled,
      setBootstrapping,
      setError,
      setRoles,
      setUsers,
      token: activeToken,
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    bootstrapping,
    error,
    notice,
    refresh,
    roles,
    setError,
    setNotice,
    users,
  };
}

async function loadAdminUserDirectoryEffect({
  isCancelled,
  setBootstrapping,
  setError,
  setRoles,
  setUsers,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  setBootstrapping: (value: boolean) => void;
  setError: (value: string | null) => void;
  setRoles: (value: AdminRoleCatalogItem[]) => void;
  setUsers: (value: AdminUserItem[]) => void;
  token: string;
}>) {
  try {
    setError(null);
    const directory = await loadAdminUserDirectory(token);
    if (isCancelled()) {
      return;
    }
    setUsers(directory.users);
    setRoles(directory.roles);
  } catch (loadError) {
    if (!isCancelled()) {
      setError(buildUserMutationError(loadError, "加载后台用户失败"));
    }
  } finally {
    if (!isCancelled()) {
      setBootstrapping(false);
    }
  }
}

async function loadAdminUserDirectory(token: string) {
  const [userResponse, roleResponse] = await Promise.all([
    listAdminUsers(token),
    listAdminRoles(token),
  ]);

  return {
    roles: roleResponse.items,
    users: userResponse.items,
  };
}

function useAdminUserFilters(users: AdminUserItem[]) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const filteredUsers = useMemo(
    () => filterAdminUsers(users, deferredSearch, roleFilter, statusFilter),
    [deferredSearch, roleFilter, statusFilter, users]
  );

  return {
    filteredUsers,
    roleFilter,
    search,
    setRoleFilter,
    setSearch,
    setStatusFilter,
    statusFilter,
  };
}

function useAdminUserEditor({
  refresh,
  roles,
  setError,
  setNotice,
  token,
}: Readonly<{
  refresh: () => Promise<void>;
  roles: AdminRoleCatalogItem[];
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  token: string | null;
}>) {
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [form, setForm] = useState<UserFormState>(createEmptyUserForm());
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function closeEditor() {
    setEditorOpen(false);
    setEditingUser(null);
    setForm(createEmptyUserForm());
  }

  function openCreateUser() {
    setEditingUser(null);
    setForm(createEmptyUserForm(roles[0]?.roleKey ?? ""));
    setEditorOpen(true);
  }

  function openEditUser(user: AdminUserItem) {
    setEditingUser(user);
    setForm(buildUserEditForm(user));
    setEditorOpen(true);
  }

  async function submitUserForm() {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (editingUser) {
        await updateAdminUser(
          token,
          editingUser.adminId,
          buildAdminUserUpdateInput(form)
        );
        setNotice("管理员资料已更新。");
      } else {
        await createAdminUser(token, buildAdminUserCreateInput(form));
        setNotice("管理员账户已创建。");
      }
      await refresh();
      closeEditor();
    } catch (submitError) {
      setError(buildUserMutationError(submitError, "管理员账户保存失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return {
    closeEditor,
    editingUser,
    form,
    isEditorOpen,
    openCreateUser,
    openEditUser,
    setForm,
    submitUserForm,
    submitting,
  };
}

function useAdminUserDeletion({
  refresh,
  setError,
  setNotice,
  token,
}: Readonly<{
  refresh: () => Promise<void>;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  token: string | null;
}>) {
  const [pendingDeleteUser, setPendingDeleteUser] =
    useState<AdminUserItem | null>(null);
  const [deletingAdminId, setDeletingAdminId] = useState<string | null>(null);

  function cancelDeleteUser() {
    if (!deletingAdminId) {
      setPendingDeleteUser(null);
    }
  }

  async function confirmDeleteUser() {
    if (!token || !pendingDeleteUser) {
      return;
    }

    setDeletingAdminId(pendingDeleteUser.adminId);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminUser(token, pendingDeleteUser.adminId);
      await refresh();
      setNotice("管理员账户已禁用。");
      setPendingDeleteUser(null);
    } catch (deleteError) {
      setError(buildUserMutationError(deleteError, "管理员账户禁用失败"));
    } finally {
      setDeletingAdminId(null);
    }
  }

  return {
    cancelDeleteUser,
    confirmDeleteUser,
    deletingAdminId,
    pendingDeleteUser,
    requestDeleteUser: setPendingDeleteUser,
  };
}
