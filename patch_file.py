import re

with open('/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/services/page.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

old_block = """    if (!userAddress) {
      setAgents([]);
      setServices([]);
      return;
    }

    const ownerAgents = agentStore.getAgentsByOwner(userAddress)
      .filter((a) => {
        const r = (a.role || "").toLowerCase();
        return r === "seller" || r === "provider / seller" || r === "hybrid";
      }) // 仅允许选择卖家或混合身份的 Agent
      .sort((a, b) => b.createdAt - a.createdAt);
    setAgents(ownerAgents);

    try {
      const rows = await listServiceRegistry(userAddress, userAddress);
      rows.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
      setServices(rows);

      if (!formAgentId && ownerAgents.length > 0) {
        setFormAgentId(ownerAgents[0].id);
      }
    } catch (error) {"""

new_block = """    if (!userAddress) {
      setAgents([]);
      setServices([]);
      return;
    }

    try {
      const serverAgents = await listAgents(userAddress);
      const localAgents = agentStore.getAgentsByOwner(userAddress);
      
      const merged: AgentIdentity[] = serverAgents.map(sa => {
        const local = localAgents.find(la => la.address.toLowerCase() === (sa.address as string).toLowerCase());
        return {
          id: String(sa.id),
          name: String(sa.name),
          role: String(sa.role),
          address: String(sa.address),
          ownerAddress: String(sa.ownerAddress),
          createdAt: Number(sa.createdAt),
          privateKey: local ? local.privateKey : "",
        };
      });

      const missingLocalAgents = localAgents.filter(la => 
        !merged.find(ma => ma.address.toLowerCase() === la.address.toLowerCase())
      );
      
      const allAgents = [...merged, ...missingLocalAgents];

      const ownerAgents = allAgents
        .filter((a) => {
          const r = (a.role || "").toLowerCase();
          return r === "seller" || r === "provider / seller" || r === "hybrid";
        })
        .sort((a, b) => b.createdAt - a.createdAt);
        
      setAgents(ownerAgents);

      const rows = await listServiceRegistry(userAddress, userAddress);
      rows.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));      
      setServices(rows);

      if (!formAgentId && ownerAgents.length > 0) {
        setFormAgentId(ownerAgents[0].id);
      }
    } catch (error) {"""

if old_block in text:
    text = text.replace(old_block, new_block)
    with open('/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/services/page.tsx', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Patch applied successfully.")
else:
    print("Old block not found.")