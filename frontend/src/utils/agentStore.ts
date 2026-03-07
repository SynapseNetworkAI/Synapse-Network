export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
  address: string;
  privateKey: string;
  createdAt: number;
  ownerAddress?: string; // Tying Agent to the Master Web3 EOA Wallet
}

const STORAGE_KEY = "a2a_agent_identities";

export const agentStore = {
  getAgents: (): AgentIdentity[] => {
    if (typeof window === "undefined") return [];
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  getAgentsByOwner: (ownerAddress: string | undefined): AgentIdentity[] => {
    const agents = agentStore.getAgents();
    if (!ownerAddress) return [];
    // Only return agents that belong to this owner, or agents created before owner logic
    return agents.filter(a => !a.ownerAddress || a.ownerAddress.toLowerCase() === ownerAddress.toLowerCase());
  },

  addAgent: (agent: AgentIdentity) => {
    const agents = agentStore.getAgents();
    agents.push(agent);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  },

  getAgent: (id: string): AgentIdentity | undefined => {
    const agents = agentStore.getAgents();
    return agents.find(a => a.id === id);
  },

  removeAgent: (id: string) => {
    let agents = agentStore.getAgents();
    agents = agents.filter(a => a.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  }
};