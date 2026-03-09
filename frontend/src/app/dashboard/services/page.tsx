"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { Plus, Search, Filter, Edit3, ToggleLeft, ToggleRight, ArrowUpDown, Trash2, X } from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import {
  createServiceRegistry,
  updateServiceRegistry,
  deleteServiceRegistry,
  listServiceRegistry,
  ServiceRegistryPayload,
  ServiceRegistryRecord,
} from "@/utils/serviceApi";

type StatusFilter = "all" | "active" | "inactive";
type SortOrder = "newest" | "oldest";

const PAGE_SIZE = 8;

export default function ServicesManagementPage() {
  const { address: userAddress } = useAccount();
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceRegistryRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formAgentId, setFormAgentId] = useState("");
  const [formName, setFormName] = useState("");
  const [formServiceId, setFormServiceId] = useState("");
  const [formPricing, setFormPricing] = useState("0.05");
  const [formEndpoint, setFormEndpoint] = useState("");
  const [formActive, setFormActive] = useState(true);

  const getAgentRole = useCallback((agentId: string): string => {
    return agents.find((agent) => agent.id === agentId)?.role || "seller";
  }, [agents]);

  const buildRegistryPayload = useCallback((payload: {
    id: string;
    agentId: string;
    name: string;
    serviceId: string;
    pricing: string;
    endpoint: string;
    isActive: boolean;
  }): ServiceRegistryPayload => {
    const agent = agents.find((item) => item.id === payload.agentId);
    if (!agent || !userAddress) {
      throw new Error("Missing agent or owner address");
    }
    return {
      id: payload.id,
      agentId: payload.agentId,
      name: payload.name,
      role: getAgentRole(payload.agentId),
      ownerAddress: userAddress,
      address: agent.address,
      serviceId: payload.serviceId,
      pricing: payload.pricing,
      endpoint: payload.endpoint,
      isActive: payload.isActive,
    };
  }, [agents, getAgentRole, userAddress]);

  const loadAll = useCallback(async () => {
    if (!userAddress) {
      setAgents([]);
      setServices([]);
      return;
    }

    const ownerAgents = agentStore.getAgentsByOwner(userAddress).sort((a, b) => b.createdAt - a.createdAt);
    setAgents(ownerAgents);

    const rows = await listServiceRegistry(userAddress, userAddress);
    rows.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
    setServices(rows);

    if (!formAgentId && ownerAgents.length > 0) {
      setFormAgentId(ownerAgents[0].id);
    }
  }, [formAgentId, userAddress]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredServices = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    const matched = services.filter((service) => {
      const byName = q.length === 0 || service.name.toLowerCase().includes(q);
      const byStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && service.isActive) ||
        (statusFilter === "inactive" && !service.isActive);
      const byAgent = agentFilter === "all" || service.agentId === agentFilter;
      return byName && byStatus && byAgent;
    });

    matched.sort((a, b) => {
      const aTime = a.createdAt || a.updatedAt || 0;
      const bTime = b.createdAt || b.updatedAt || 0;
      return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
    });
    return matched;
  }, [services, nameQuery, statusFilter, agentFilter, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pageServices = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredServices.slice(start, start + PAGE_SIZE);
  }, [filteredServices, currentPage]);

  const agentMap = useMemo(() => {
    const map: Record<string, AgentIdentity> = {};
    agents.forEach((agent) => {
      map[agent.id] = agent;
    });
    return map;
  }, [agents]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setFormName("");
    setFormServiceId("");
    setFormPricing("0.05");
    setFormEndpoint("");
    setFormActive(true);
    if (agents.length > 0) {
      setFormAgentId(agents[0].id);
    }
  }, [agents]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    resetForm();
  }, [resetForm]);

  const closeDeleteModal = useCallback(() => {
    if (isDeleting) return;
    setDeleteTarget(null);
  }, [isDeleting]);

  useEffect(() => {
    if (!isModalOpen && !deleteTarget) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (deleteTarget) {
          closeDeleteModal();
          return;
        }
        closeModal();
      }
    };

    document.body.style.overflow = "hidden";
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDeleteModal, closeModal, deleteTarget, isModalOpen]);

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const startEdit = (service: ServiceRegistryRecord) => {
    setEditingId(service.id);
    setFormAgentId(service.agentId || "");
    setFormName(service.name);
    setFormServiceId(service.serviceId);
    setFormPricing(service.pricing);
    setFormEndpoint(service.endpoint);
    setFormActive(service.isActive);
    setIsModalOpen(true);
  };

  const saveConfig = async () => {
    if (!formAgentId || !formName || !formServiceId || !formPricing || !formEndpoint) {
      toast.error("Please complete agent, name, service id, pricing and endpoint.");
      return;
    }

    const conflict = services.find(
      (item) =>
        item.agentId === formAgentId &&
        item.serviceId === formServiceId &&
        item.id !== editingId
    );
    if (conflict) {
      toast.error("Service ID already exists under selected agent.");
      return;
    }

    if (editingId) {
      try {
        const backendPayload = buildRegistryPayload({
          id: editingId,
          agentId: formAgentId,
          name: formName,
          serviceId: formServiceId,
          pricing: formPricing,
          endpoint: formEndpoint,
          isActive: formActive,
        });
        await updateServiceRegistry(backendPayload, userAddress || "");
        toast.success("Service configuration updated.");
        await loadAll();
        closeModal();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update backend service";
        toast.error(message);
      }
      return;
    }

    const newId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();

    try {
      const backendPayload = buildRegistryPayload({
        id: newId,
        agentId: formAgentId,
        name: formName,
        serviceId: formServiceId,
        pricing: formPricing,
        endpoint: formEndpoint,
        isActive: formActive,
      });
      await createServiceRegistry(backendPayload, userAddress || "");
      toast.success("Service registered.");
      await loadAll();
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register backend service";
      toast.error(message);
    }
  };

  const handleToggleStatus = async (service: ServiceRegistryRecord) => {
    if (!service.agentId) {
      toast.error("Service missing agent linkage. Please edit and select an agent.");
      return;
    }
    const nextActive = !service.isActive;

    try {
      const backendPayload = buildRegistryPayload({
        id: service.id,
        agentId: service.agentId,
        name: service.name,
        serviceId: service.serviceId,
        pricing: service.pricing,
        endpoint: service.endpoint,
        isActive: nextActive,
      });
      await updateServiceRegistry(backendPayload, userAddress || "");
      toast.success(nextActive ? "Service set to ACTIVE" : "Service set to INACTIVE");
      await loadAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync service status";
      toast.error(message);
    }
  };

  const requestDeleteService = (service: ServiceRegistryRecord) => {
    setDeleteTarget(service);
  };

  const confirmDeleteService = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      setIsDeleting(true);
      await deleteServiceRegistry(deleteTarget.id, userAddress || "");

      if (editingId === deleteTarget.id) {
        closeModal();
      }

      toast.success("Service deleted.");
      setDeleteTarget(null);
      await loadAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete service";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const editingService = useMemo(
    () => (editingId ? services.find((service) => service.id === editingId) || null : null),
    [editingId, services]
  );

  return (
    <div className="p-8 mx-auto space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Server Management</h1>
        <p className="mt-1 text-gray-400">Create and manage services linked to agents (one service = one API interface).</p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center px-4 py-2 text-xs font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Register Service
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 border border-gray-800 rounded-xl bg-black/50 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute w-4 h-4 text-gray-500 left-3 top-3" />
          <input
            type="text"
            value={nameQuery}
            onChange={(e) => {
              setNameQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by service name"
            className="w-full py-2 pl-10 pr-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
          />
        </div>

        <div className="relative">
          <Filter className="absolute w-4 h-4 text-gray-500 left-3 top-3" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setCurrentPage(1);
            }}
            className="w-full py-2 pl-10 pr-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="relative">
          <ArrowUpDown className="absolute w-4 h-4 text-gray-500 left-3 top-3" />
          <select
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value as SortOrder);
              setCurrentPage(1);
            }}
            className="w-full py-2 pl-10 pr-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        <div className="md:col-span-4">
          <select
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
          >
            <option value="all">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden border border-gray-800 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3">Service Name</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Service ID</th>
                <th className="px-4 py-3">Pricing</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80 bg-black/40">
              {pageServices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    No services matched current filters.
                  </td>
                </tr>
              ) : (
                pageServices.map((service) => {
                  const active = service.isActive;
                  const agentName = service.agentId ? agentMap[service.agentId]?.name || "Unknown Agent" : "Unknown Agent";
                  return (
                    <tr key={service.id} className="transition-colors hover:bg-gray-900/40">
                      <td className="px-4 py-3 font-medium text-white">{service.name}</td>
                      <td className="px-4 py-3 text-gray-300">{agentName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-blue-300">{service.serviceId}</td>
                      <td className="px-4 py-3 text-green-400">{service.pricing} USDC</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 text-xs border rounded-full ${
                            active
                              ? "text-green-400 border-green-500/40 bg-green-500/10"
                              : "text-gray-400 border-gray-600/50 bg-gray-700/20"
                          }`}
                        >
                          {active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-gray-400 truncate">{service.endpoint}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(service)}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-300 transition-colors border rounded-lg border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20"
                          >
                            <Edit3 className="w-3.5 h-3.5 mr-1" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(service)}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-300 transition-colors border rounded-lg border-green-500/30 bg-green-500/10 hover:bg-green-500/20"
                          >
                            {active ? <ToggleRight className="w-3.5 h-3.5 mr-1" /> : <ToggleLeft className="w-3.5 h-3.5 mr-1" />}
                            {active ? "Offline" : "Online"}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteService(service)}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-red-300 transition-colors border rounded-lg border-red-500/30 bg-red-500/10 hover:bg-red-500/20"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <p className="text-gray-500">
          Showing {pageServices.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1} -{" "}
          {Math.min(currentPage * PAGE_SIZE, filteredServices.length)} of {filteredServices.length}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 text-xs text-gray-300 border border-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="px-3 py-1.5 text-xs text-gray-300 border border-gray-700 rounded-lg">
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1.5 text-xs text-gray-300 border border-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <button
            type="button"
            aria-label="Close modal backdrop"
            onClick={closeModal}
            className="absolute inset-0"
          />

          <div className="relative z-10 w-full max-w-5xl border border-gray-700 shadow-2xl rounded-2xl bg-gradient-to-b from-gray-950 to-black">
            <div className="flex items-start justify-between px-8 py-6 border-b border-gray-800 bg-black/30">
              <div>
                <h2 className="text-base font-bold tracking-widest text-white uppercase">
                  {editingId ? "Edit Service Configuration" : "Register Service Configuration"}
                </h2>
                <p className="mt-2 text-sm text-gray-500">Press ESC or click outside to close</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close modal"
                className="p-2.5 text-gray-400 transition-colors border border-gray-700 rounded-lg hover:text-white hover:bg-gray-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-8">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block mb-2 text-xs font-bold tracking-wider text-gray-500 uppercase">Agent</label>
                  <select
                    value={formAgentId}
                    onChange={(e) => setFormAgentId(e.target.value)}
                    className="w-full px-4 py-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                  >
                    <option value="">Select Agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-2 text-xs font-bold tracking-wider text-gray-500 uppercase">Service Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Service Name"
                    className="w-full px-4 py-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block mb-2 text-xs font-bold tracking-wider text-gray-500 uppercase">Service ID</label>
                  <input
                    type="text"
                    value={formServiceId}
                    onChange={(e) => setFormServiceId(e.target.value.toUpperCase().replaceAll(/[^A-Z0-9_]/g, ""))}
                    placeholder="Service ID"
                    className="w-full px-4 py-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block mb-2 text-xs font-bold tracking-wider text-gray-500 uppercase">Pricing (USDC)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={formPricing}
                    onChange={(e) => setFormPricing(e.target.value)}
                    placeholder="Pricing (USDC)"
                    className="w-full px-4 py-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block mb-2 text-xs font-bold tracking-wider text-gray-500 uppercase">Endpoint API</label>
                  <input
                    type="url"
                    value={formEndpoint}
                    onChange={(e) => setFormEndpoint(e.target.value)}
                    placeholder="Endpoint API"
                    className="w-full px-4 py-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-5 mt-6 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setFormActive((prev) => !prev)}
                  className={`px-5 py-2.5 text-xs font-bold border rounded-lg transition-colors ${
                    formActive
                      ? "text-green-400 border-green-500/40 bg-green-500/10"
                      : "text-gray-400 border-gray-700 bg-gray-900"
                  }`}
                >
                  {formActive ? "ACTIVE" : "INACTIVE"}
                </button>

                <button
                  type="button"
                  onClick={saveConfig}
                  className="inline-flex items-center px-5 py-2.5 text-xs font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {editingId ? "Save Config" : "Register Service"}
                </button>

                {editingService && (
                  <button
                    type="button"
                    onClick={() => requestDeleteService(editingService)}
                    className="inline-flex items-center px-5 py-2.5 text-xs font-bold text-red-300 transition-colors border rounded-lg border-red-500/30 bg-red-500/10 hover:bg-red-500/20"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete
                  </button>
                )}

                <button
                  type="button"
                  onClick={closeModal}
                  className="px-5 py-2.5 text-xs font-bold text-gray-300 transition-colors border border-gray-700 rounded-lg hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close delete confirmation backdrop"
            onClick={closeDeleteModal}
            className="absolute inset-0"
            disabled={isDeleting}
          />
          <div className="relative z-10 w-full max-w-md border border-red-500/40 rounded-2xl bg-gradient-to-b from-gray-950 to-black">
            <div className="px-6 py-4 border-b border-gray-800 bg-black/30">
              <h2 className="text-sm font-bold tracking-widest text-red-300 uppercase">Confirm Delete</h2>
              <p className="mt-2 text-xs text-gray-400">
                Delete service <span className="font-semibold text-white">{deleteTarget.name}</span>? This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-gray-300 transition-colors border border-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteService}
                disabled={isDeleting}
                className="inline-flex items-center px-4 py-2 text-xs font-bold text-red-200 transition-colors border rounded-lg border-red-500/40 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
