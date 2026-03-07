'use client';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import ClientGuard from '@/components/ClientGuard';
import { ArrowLeft, CheckCircle, Package, FileText, Activity } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { agentStore } from '@/utils/agentStore';

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { address } = useAccount();
  const [task, setTask] = useState<Record<string, string | number | null | undefined> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTask = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/client/tasks/${params.id}`, {
          headers: {
            "Authorization": "Bearer active",
            "X-User-Address": address || ""
          }
        });
        if (res.ok) {
          const data = await res.json();
          setTask(data);
        }
      } catch (err) {
        console.error("Failed to fetch task details:", err);
      } finally {
        setLoading(false);
      }
    };
    if (address && params.id) {
      fetchTask();
    }
  }, [address, params.id]);

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'PENDING': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
      case 'PROCESSING': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'DELIVERED': return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
      case 'RELEASED': return 'text-green-400 bg-green-400/10 border-green-400/20';
      case 'DISPUTED': return 'text-red-400 bg-red-400/10 border-red-400/20';
      default: return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    }
  };

  const getTaskRoleText = (t: Record<string, string | number | null | undefined>) => {
    const fleetWallets = agentStore.getAgentsByOwner(address).map(a => a.address?.toLowerCase());
    const isBuyer = t.buyer && typeof t.buyer === 'string' && fleetWallets.includes(t.buyer.toLowerCase());
    const isSeller = t.seller && typeof t.seller === 'string' && fleetWallets.includes(t.seller.toLowerCase());
    if (isBuyer && isSeller) return 'Internal task (Both Buyer and Seller)';
    if (isBuyer) return 'You are the Buyer';
    if (isSeller) return 'You are the Seller';
    return 'Observer';
  };

  ifLoading:
  if (loading) {
    return (
      <ClientGuard>
        <div className="p-8 mx-auto max-w-7xl animate-pulse">
          <div className="w-1/4 h-8 mb-8 bg-gray-800 rounded"></div>
          <div className="h-64 bg-gray-900 border border-gray-800 rounded-lg"></div>
        </div>
      </ClientGuard>
    );
  }

  if (!task) {
    return (
      <ClientGuard>
        <div className="p-8 mx-auto mt-20 text-center max-w-7xl">
          <h2 className="text-2xl font-bold text-gray-500">Task Not Found</h2>
          <button onClick={() => router.back()} className="mt-4 text-emerald-500 hover:underline">
            &larr; Go Back
          </button>
        </div>
      </ClientGuard>
    );
  }

  return (
    <ClientGuard>
      <div className="max-w-5xl p-4 mx-auto md:p-8">
        <button 
          onClick={() => router.back()}
          className="flex items-center mb-6 space-x-2 text-gray-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Tasks</span>
        </button>

        <div className="overflow-hidden bg-gray-900 border border-gray-800 rounded-lg">
          {/* Header */}
          <div className="flex flex-col justify-between gap-4 p-6 border-b border-gray-800 bg-gray-900/50 md:flex-row md:items-end">
            <div>
              <div className="flex items-center mb-2 space-x-3">
                <h1 className="text-2xl font-bold text-white">{task.title || 'Untitled Task'}</h1>
                <span className={`px-3 py-1 text-xs border rounded-full font-bold ${getStatusColor(task.status as string)}`}>
                  {task.status}
                </span>
              </div>
              <p className="flex items-center space-x-2 text-gray-400">
                <FileText className="w-4 h-4" />
                <span>{task.description || 'No description provided'}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-3xl font-bold text-white">${parseFloat(task.amount as string || '0').toFixed(2)}</p>
              <p className="mt-1 font-mono text-sm text-gray-500">ID: {task.taskId}</p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs tracking-wider text-gray-500 uppercase">Your Role</p>
                <div className="flex items-center px-3 py-2 space-x-2 border rounded text-emerald-400 bg-emerald-400/10 border-emerald-400/20">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">{getTaskRoleText(task)}</span>
                </div>
              </div>
              
              <div>
                <p className="mb-1 text-xs tracking-wider text-gray-500 uppercase">Buyer Agent</p>
                <p className="p-2 font-mono text-sm text-gray-300 break-all border border-gray-800 rounded bg-gray-950">
                  {task.buyer || 'N/A'}
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs tracking-wider text-gray-500 uppercase">Seller Agent</p>
                <p className="p-2 font-mono text-sm text-gray-300 break-all border border-gray-800 rounded bg-gray-950">
                  {task.seller || 'Pending Acceptance...'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs tracking-wider text-gray-500 uppercase">Blockchain Tracking</p>
                <div className="p-3 space-y-3 border border-gray-800 rounded bg-gray-950">
                  <div>
                    <span className="block mb-1 text-xs text-gray-500">Transaction Hash:</span>
                    {task.txHash ? (
                      <a 
                        href={`http://127.0.0.1:8545/tx/${task.txHash}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="font-mono text-xs text-blue-400 break-all hover:underline"
                      >
                        {task.txHash}
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-gray-600">Pending</span>
                    )}
                  </div>
                  <div>
                    <span className="block mb-1 text-xs text-gray-500">Block Number:</span>
                    <span className="font-mono text-xs text-gray-300">
                      {task.blockNumber ? `#${task.blockNumber}` : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Result Payload Area */}
          <div className="p-6 border-t border-gray-800">
            <div className="flex items-center mb-4 space-x-2">
              <Package className="w-5 h-5 text-emerald-500" />
              <h3 className="text-lg font-bold text-white">Delivery Result Payload</h3>
            </div>
            {task.result_data ? (
              <div className="bg-[#0D1117] p-4 rounded-lg border border-gray-700/50 overflow-x-auto">
                <pre className="font-mono text-sm whitespace-pre-wrap text-emerald-400/90 word-break">
                  {task.result_data}
                </pre>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-gray-800 border-dashed rounded-lg bg-gray-950">
                <Activity className="w-8 h-8 mb-3 text-gray-600 animate-pulse" />
                <p className="text-gray-400">No delivery data payload yet.</p>
                <p className="mt-1 text-sm text-gray-600">
                  Once the seller completes and delivers the task, the response will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ClientGuard>
  );
}
