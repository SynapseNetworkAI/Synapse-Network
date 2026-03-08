'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ArrowLeft, Send, Loader2, AlertCircle } from 'lucide-react';
import ClientGuard from '@/components/ClientGuard';
import { agentStore } from '@/utils/agentStore';

function NewTaskForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cloneId = searchParams.get('clone');
  const { address } = useAccount();

  const [loading, setLoading] = useState(!!cloneId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [buyerAgent, setBuyerAgent] = useState('');
  
  const [myAgents, setMyAgents] = useState<{address: string, name: string}[]>([]);

  useEffect(() => {
    // Load user's buyer agents
    const all = agentStore.getAgents();
    const myBuy = all.filter(a => a.ownerAddress?.toLowerCase() === address?.toLowerCase() && a.role.toLowerCase().includes('buyer'));
    setMyAgents(myBuy);
    if (myBuy.length > 0) {
      setBuyerAgent(myBuy[0].address);
    }
  }, [address]);

  useEffect(() => {
    const fetchClone = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/client/tasks/${cloneId}`, {
          headers: {
            "Authorization": "Bearer active",
            "X-User-Address": address || ""
          }
        });
        if (res.ok) {
          const data = await res.json();
          setTitle(data.title ? data.title + ' (Copy)' : '');
          setAmount(data.amount || '');
          setDescription(data.description || '');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (cloneId && address) {
      fetchClone();
    }
  }, [cloneId, address]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !amount || !buyerAgent) {
      setError("Please fill all required fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/client/tasks/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer active',
          'X-User-Address': address || ""
        },
        body: JSON.stringify({
          title: title,
          description: description,
          amount: amount.toString(),
          buyer_agent: buyerAgent.toLowerCase()
        })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        router.push('/dashboard/tasks');
      } else {
        setError(data.detail || 'Failed to publish task');
      }
    } catch (err) {
      console.error(err);
      setError('Connection error while saving task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl p-4 mx-auto md:p-8">
      <button
        onClick={() => router.back()}
        className="flex items-center mb-6 text-sm text-gray-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </button>

      <div className="p-6 bg-gray-900 border border-gray-800 shadow-lg rounded-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Publish New Task</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create a work order for AI agents to automate.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 mb-4 text-green-400 animate-spin" />
            <p className="text-gray-400">Loading cloned task data...</p>
          </div>
        ) : (
          <form onSubmit={handlePublish} className="space-y-6">
            {error && (
              <div className="p-4 border rounded-lg bg-red-500/10 border-red-500/20">
                <div className="flex items-center text-red-500">
                  <AlertCircle className="flex-shrink-0 w-5 h-5 mr-3" />
                  <p>{error}</p>
                </div>
              </div>
            )}
            
            <div>
              <label className="block mb-2 text-sm font-medium text-gray-300">Task Title</label>
              <input
                type="text"
                required
                className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-green-500"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Data extraction script"
              />
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-gray-300">Assign to Buyer Agent</label>
              <select 
                className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-green-500 appearance-none"
                style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                value={buyerAgent}
                onChange={e => setBuyerAgent(e.target.value)}
                required
              >
                <option value="">-- Select an Agent --</option>
                {myAgents.map(a => (
                  <option key={a.address} value={a.address}>{a.name} ({a.address.substring(0,6)}...)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-gray-300">Reward Amount (Tokens)</label>
              <div className="relative">
                <span className="absolute inset-y-0 text-gray-500 left-4 top-2.5">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className="w-full pl-8 pr-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-green-500"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="50.00"
                />
              </div>
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-gray-300">Task Description / Requirements</label>
              <textarea
                required
                rows={5}
                className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-green-500"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details of the job..."
              />
            </div>

            <div className="flex justify-end pt-4 space-x-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !buyerAgent}
                className="flex items-center px-6 py-2.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-500 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                {saving ? 'Publishing...' : 'Publish Task'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function NewTaskPage() {
  return (
    <ClientGuard>
      <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /></div>}>
        <NewTaskForm />
      </Suspense>
    </ClientGuard>
  );
}
