"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import Link from "next/link";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";
import { Bot, Plus, Search, Edit3, Copy, Check, Wallet, ShieldAlert, X, Eye } from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";

type RoleFilter = "all" | "seller" | "buyer" | "hybrid";

export default function AgentsManagementPage() {
  const { address: userAddress } = useAccount();
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [nameQuery, setNameQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState("seller");
  const [formAddress, setFormAddress] = useState("");
  const [formPrivateKey, setFormPrivateKey] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState("0.00");
  const [ethBalance, setEthBalance] = useState("0.0000");
  const [balanceLoading, setBalanceLoading] = useState(false);

  const loadAgents = useCallback(() => {
    const rows = agentStore.getAgentsByOwner(userAddress).sort((a, b) => b.createdAt - a.createdAt);
    setAgents(rows);
  }, [userAddress]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const filteredAgents = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return agents.filter((agent) => {
      const byName = q.length === 0 || agent.name.toLowerCase().includes(q);
      const role = (agent.role || "seller").toLowerCase();
      const byRole = roleFilter === "all" || role.includes(roleFilter);
      return byName && byRole;
    });
  }, [agents, nameQuery, roleFilter]);

  const generateWalletIdentity = useCallback(() => {
    const wallet = ethers.Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
  }, []);

  useEffect(() => {
    if (editingId) {
      return;
    }
    if (!formAddress || !formPrivateKey) {
      const wallet = generateWalletIdentity();
      setFormAddress(wallet.address);
      setFormPrivateKey(wallet.privateKey);
    }
  }, [editingId, formAddress, formPrivateKey, generateWalletIdentity]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setFormName("");
    setFormRole("seller");
    const wallet = generateWalletIdentity();
    setFormAddress(wallet.address);
    setFormPrivateKey(wallet.privateKey);
    setShowPrivateKey(false);
    setCopiedAddr(false);
    setCopiedKey(false);
  }, [generateWalletIdentity]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    resetForm();
  }, [resetForm]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    document.body.style.overflow = "hidden";
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [isModalOpen, closeModal]);

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const startEdit = (agent: AgentIdentity) => {
    setEditingId(agent.id);
    setFormName(agent.name);
    setFormRole((agent.role || "seller").toLowerCase());
    setFormAddress(agent.address);
    setFormPrivateKey(agent.privateKey);
    setShowPrivateKey(false);
    setCopiedAddr(false);
    setCopiedKey(false);
    setIsModalOpen(true);
  };

  const copyToClipboard = async (value: string, field: "addr" | "key") => {
    try {
      await navigator.clipboard.writeText(value);
      if (field === "addr") {
        setCopiedAddr(true);
        setTimeout(() => setCopiedAddr(false), 1200);
      } else {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 1200);
      }
    } catch {
      toast.error("Failed to copy.");
    }
  };

  const saveAgent = () => {
    if (!formName) {
      toast.error("Agent name is required.");
      return;
    }

    if (editingId) {
      agentStore.updateAgent(editingId, { name: formName, role: formRole });
      toast.success("Agent updated.");
      loadAgents();
      closeModal();
      return;
    }

    const newId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();

    agentStore.addAgent({
      id: newId,
      name: formName,
      role: formRole,
      address: formAddress,
      privateKey: formPrivateKey,
      createdAt: Date.now(),
      ownerAddress: userAddress,
    });

    toast.success("Agent created.");
    loadAgents();
    closeModal();
  };

  useEffect(() => {
    if (!isModalOpen || !formAddress) {
      return;
    }

    const fetchBalances = async () => {
      try {
        setBalanceLoading(true);
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);
        const [usdcRaw, ethRaw] = await Promise.all([usdcContract.balanceOf(formAddress), provider.getBalance(formAddress)]);
        setUsdcBalance(Number.parseFloat(ethers.formatUnits(usdcRaw, 18)).toFixed(2));
        setEthBalance(Number.parseFloat(ethers.formatEther(ethRaw)).toFixed(4));
      } catch {
        setUsdcBalance("0.00");
        setEthBalance("0.0000");
      } finally {
        setBalanceLoading(false);
      }
    };

    fetchBalances();
  }, [isModalOpen, formAddress]);

  return (
    <div className="p-8 mx-auto space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Agent Management</h1>
        <p className="mt-1 text-gray-400">Create and maintain seller agents. One wallet can own multiple agents.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 border border-gray-800 rounded-xl bg-black/50 md:grid-cols-2">
        <div className="relative">
          <Search className="absolute w-4 h-4 text-gray-500 left-3 top-3" />
          <input
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search by agent name"
            className="w-full py-2 pl-10 pr-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
        >
          <option value="all">All roles</option>
          <option value="seller">seller</option>
          <option value="buyer">buyer</option>
          <option value="hybrid">hybrid</option>
        </select>
      </div>

      <div className="overflow-hidden border border-gray-800 rounded-xl">
        <div className="flex items-center justify-end p-3 border-b border-gray-800 bg-black/30">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center px-3 py-2 text-xs font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Agent
          </button>
        </div>
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 bg-black/40">
            {filteredAgents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-500">
                  No agents found.
                </td>
              </tr>
            ) : (
              filteredAgents.map((agent) => (
                <tr key={agent.id} className="transition-colors hover:bg-gray-900/40">
                  <td className="px-4 py-3 font-medium text-white">
                    <span className="inline-flex items-center gap-2">
                      <Bot className="w-4 h-4 text-green-400" />
                      {agent.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{agent.role || "seller"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[320px]">{agent.address}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <Link
                        href={`/dashboard/agents/${agent.id}`}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors border rounded-lg border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Details
                      </Link>
                      <button
                        type="button"
                        onClick={() => startEdit(agent)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-300 transition-colors border rounded-lg border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20"
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close modal backdrop"
            onClick={closeModal}
            className="absolute inset-0"
          />
          <div
            className="relative z-10 w-full max-w-5xl max-h-[90vh] overflow-hidden border border-gray-700 rounded-2xl bg-gradient-to-b from-gray-950 to-black"
          >
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-800 bg-black/30">
              <div>
                <h2 className="text-sm font-bold tracking-widest text-white uppercase">
                  {editingId ? "Edit Agent" : "Create Agent"}
                </h2>
                <p className="mt-1 text-xs text-gray-500">Press ESC or click outside to close</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close modal"
                className="p-2 text-gray-400 transition-colors border border-gray-700 rounded-lg hover:text-white hover:bg-gray-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-132px)]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Agent Name"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                />
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
                >
                  <option value="seller">seller</option>
                  <option value="buyer">buyer</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 mt-4 lg:grid-cols-[1fr_230px]">
                <div className="p-4 border border-gray-800 rounded-xl bg-black/40">
                  <h3 className="flex items-center mb-4 text-sm font-bold tracking-widest text-white uppercase">
                    <Wallet className="w-4 h-4 mr-2 text-gray-400" />
                    Agent Cryptographic Identity
                  </h3>

                  <div className="mb-4">
                    <span className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">Public Address</span>
                    <div className="flex items-center">
                      <code className="flex-1 p-3 overflow-hidden font-mono text-xs text-green-400 border border-gray-800 rounded-l-lg bg-gray-900/80 text-ellipsis">
                        {formAddress}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(formAddress, "addr")}
                        className="p-3 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
                      >
                        {copiedAddr ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">Agent Wallet Private Key</span>
                    <div className="flex items-start p-3 mb-3 border bg-red-950/20 border-red-900/40 rounded-xl">
                      <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                      <p className="text-xs text-red-300">CRITICAL: Keep this key secret and back it up safely.</p>
                    </div>

                    <div className="flex items-center h-12">
                      <div className="relative flex items-center flex-1 h-full px-3 overflow-hidden border border-gray-800 rounded-l-lg bg-gray-900/80">
                        <div className={`font-mono text-xs break-all ${showPrivateKey ? "text-red-400" : "text-gray-600 blur-sm select-none"}`}>
                          {formPrivateKey}
                        </div>
                        {!showPrivateKey && (
                          <button
                            type="button"
                            aria-label="Reveal private key"
                            className="absolute inset-0 z-10 flex items-center justify-center transition-colors cursor-pointer hover:bg-white/5"
                            onClick={() => setShowPrivateKey(true)}
                          >
                            <span className="px-3 py-1 text-xs font-bold text-gray-300 border border-gray-700 rounded bg-black/90">
                              Click to reveal
                            </span>
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(formPrivateKey, "key")}
                        className="flex items-center justify-center h-full px-4 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
                      >
                        {copiedKey ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="p-3 border border-gray-800 rounded-lg bg-gray-900/40">
                      <div className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">USDC Balance</div>
                      <div className="mt-1 font-mono text-base font-bold text-green-400">
                        {balanceLoading ? "..." : usdcBalance}
                        <span className="ml-1 text-xs text-gray-500">USDC</span>
                      </div>
                    </div>
                    <div className="p-3 border border-gray-800 rounded-lg bg-gray-900/40">
                      <div className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">Native Balance</div>
                      <div className="mt-1 font-mono text-base font-bold text-blue-400">
                        {balanceLoading ? "..." : ethBalance}
                        <span className="ml-1 text-xs text-gray-500">ETH</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center p-4 text-center border border-green-500/20 rounded-xl bg-green-500/5">
                  <span className="mb-3 text-xs font-bold tracking-widest text-white uppercase">Address QR</span>
                  <div className="inline-block p-3 mb-3 bg-white rounded-lg shadow-[0_0_20px_rgba(34,197,94,0.12)]">
                    <QRCodeSVG value={formAddress || "0x"} size={140} level="H" />
                  </div>
                  <p className="font-mono text-[10px] leading-relaxed text-gray-400 break-all">{formAddress}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-6 py-4 border-t border-gray-800 bg-black/30">
              <button
                type="button"
                onClick={saveAgent}
                className="inline-flex items-center px-4 py-2 text-xs font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {editingId ? "Save Agent" : "Create Agent"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 text-xs font-bold text-gray-300 transition-colors border border-gray-700 rounded-lg hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
