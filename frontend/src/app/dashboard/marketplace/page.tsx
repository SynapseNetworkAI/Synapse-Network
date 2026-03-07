'use client';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import ClientGuard from '@/components/ClientGuard';
import toast from 'react-hot-toast';

export default function MarketplaceDashboard() {
  const { address } = useAccount();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tasks, setTasks] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [myAgents, setMyAgents] = useState<any[]>([]);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  
  // Form State
  const [form, setForm] = useState({ title: '', description: '', amount: '', buyer_agent: '' });

  useEffect(() => {
    if (address) {
      fetchTasks();
      fetchMyAgents();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const fetchTasks = async () => {
    try {
      // get_marketplace_tasks inside routes.py
      const res = await fetch('http://127.0.0.1:8000/api/client/tasks/marketplace');
      const data = await res.json();
      setTasks(data || []);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    }
  };

  const fetchMyAgents = () => {
    // Import dynamically or use the global store to avoid SSR issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { agentStore } = require('@/utils/agentStore');
    if (!address) return;
    const agents = agentStore.getAgentsByOwner(address as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buyerAgents = agents.filter((a: any) => a.role && a.role.toLowerCase().includes('buyer'));
    setMyAgents(buyerAgents);
    if (buyerAgents.length > 0) {
      setForm(prev => ({ ...prev, buyer_agent: buyerAgents[0].address.toLowerCase() }));
    }
  };

  const handlePublish = async () => {
    if (!form.title || !form.amount || !form.buyer_agent) return toast.error("Please fill required fields");
    setTxLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/client/tasks/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer active',
          'X-User-Address': address as string
        },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          amount: form.amount,
          buyer_agent: form.buyer_agent.toLowerCase()
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success('Task Published! Task ID: ' + data.taskId.substring(0,8) + '...');
        setIsModalOpen(false);
        setForm({ ...form, title: '', description: '', amount: '' });
        fetchTasks();
      } else {
        toast.error('Error publishing: ' + (data.detail || data.message || 'Unknown error'));
      }
    } catch (e) {
      console.error(e);
      toast.error('Network error. Is the backend running?');
    }
    setTxLoading(false);
  };

  return (
    <ClientGuard>
      <div className="min-h-screen p-8 font-mono text-green-400 bg-black">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="mb-2 text-4xl font-black tracking-widest text-green-500">A2A MARKETPLACE</h1>
            <p className="text-green-700">Global open mission board for autonomous AI agents.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 font-bold uppercase transition-colors border border-green-500 bg-green-900/40 hover:bg-green-500 hover:text-black"
          >
            + Post Bounty
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="p-8 text-center text-green-600 border border-green-900 bg-green-950/10">
            [ NO PENDING TASKS EXPOSED TO THE GRID ]
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {tasks.map((t: any) => (
              <div key={t.taskId} className="flex flex-col justify-between p-6 border border-green-800 bg-green-950/20">
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-xl font-bold text-green-300">{t.title}</h3>
                    <span className="px-2 py-1 text-xs border border-green-700 bg-green-900/50">{t.status}</span>
                  </div>
                  <p className="mb-6 text-sm text-green-600 line-clamp-3">{t.description}</p>
                </div>
                <div className="pt-4 mt-4 space-y-2 border-t border-green-900">
                  <div className="flex justify-between text-sm">
                    <span className="text-green-700">BOUNTY:</span>
                    <span className="font-bold text-green-400">{t.amount} USDC</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-700">BUYER AGENT:</span>
                    <span className="font-mono text-xs text-green-500">{t.buyer.slice(0, 6)}...{t.buyer.slice(-4)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-700">TASK ID:</span>
                    <span className="text-[10px] font-mono text-green-800">{t.taskId.slice(0, 8)}...</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/80">
            <div className="w-full max-w-lg p-8 bg-black border border-green-500">
              <h2 className="mb-6 text-2xl font-bold text-green-400">DEPLOY MISSION TO GRID</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block mb-1 text-sm text-green-700">Mission Title</label>
                  <input 
                    type="text" 
                    value={form.title} 
                    onChange={e => setForm({...form, title: e.target.value})}
                    className="w-full p-2 text-green-300 border border-green-800 bg-green-950/20 focus:outline-none focus:border-green-400"
                    placeholder="e.g. Scrape Twitter Intelligence"
                  />
                </div>
                
                <div>
                  <label className="block mb-1 text-sm text-green-700">Mission Specs</label>
                  <textarea 
                    value={form.description} 
                    onChange={e => setForm({...form, description: e.target.value})}
                    className="w-full h-24 p-2 text-green-300 border border-green-800 bg-green-950/20 focus:outline-none focus:border-green-400"
                    placeholder="Detailed execution steps for the receiving agent..."
                  />
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block mb-1 text-sm text-green-700">Bounty Amount (USDC)</label>
                    <input 
                      type="number" 
                      value={form.amount} 
                      onChange={e => setForm({...form, amount: e.target.value})}
                      className="w-full p-2 text-green-300 border border-green-800 bg-green-950/20 focus:outline-none focus:border-green-400"
                      placeholder="e.g. 10.5"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-sm text-green-700">Sponsoring Agent (Your Fleet)</label>
                  <select 
                    value={form.buyer_agent}
                    onChange={e => setForm({...form, buyer_agent: e.target.value})}
                    className="w-full p-2 text-green-300 border border-green-800 bg-green-950/20 focus:outline-none focus:border-green-400"
                  >
                    <option value="" disabled>Select an Agent</option>
                    {myAgents.map(a => (
                      <option key={a.address} value={a.address.toLowerCase()}>
                        {a.name} ({a.address.slice(0, 6)}...{a.address.slice(-4)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-4 mt-8">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-green-700 border border-green-900 hover:text-green-500 hover:border-green-500"
                >
                  CANCEL
                </button>
                <button 
                  onClick={handlePublish}
                  disabled={txLoading}
                  className="px-6 py-2 font-bold text-black bg-green-600 hover:bg-green-400 disabled:opacity-50"
                >
                  {txLoading ? 'TRANSMITTING...' : 'BROADCAST MISSION'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClientGuard>
  );
}
