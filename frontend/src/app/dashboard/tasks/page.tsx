'use client';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import ClientGuard from '@/components/ClientGuard';
import { agentStore } from '@/utils/agentStore';
import { RefreshCw, ArrowRight } from 'lucide-react';

export default function MyTasksDashboard() {
  const { address } = useAccount();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchTasks = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/client/fleet/tasks', {
        headers: {
          "Authorization": "Bearer active",
          "X-User-Address": address
        }
      });
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch fleet tasks', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (address) {
      fetchTasks();
    }
  }, [address, fetchTasks]);

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

  const fleetWallets = agentStore.getAgentsByOwner(address).map(a => a.address?.toLowerCase());

  // Filter tasks
  const publishedTasks = tasks.filter(t => t.buyer && fleetWallets.includes(t.buyer.toLowerCase()));
  const acceptedTasks = tasks.filter(t => t.seller && fleetWallets.includes(t.seller.toLowerCase()));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TaskCard = ({ t, role }: { t: any; role: string }) => (
    <div key={t.taskId} className="p-5 transition-colors bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-bold text-white">{t.title || 'Untitled Task'}</h3>
            <span className={`px-2 py-1 text-xs border rounded-full ${getStatusColor(t.status)}`}>
              {t.status}
            </span>
          </div>
          <p className="max-w-2xl mt-2 text-sm text-gray-400">{t.description || 'No description provided'}</p>
        </div>
        <div className="text-right flex flex-col items-end">
          <p className="text-xl font-mono text-green-400 font-bold">${parseFloat(t.amount || '0').toFixed(2)}</p>
          <p className="mt-1 text-xs text-gray-500">ID: {t.taskId.substring(0, 8)}...</p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4 py-3 mt-4 border-t border-gray-800">
        <div>
          <p className="text-xs text-gray-500 uppercase">Buyer Agent</p>
          <p className="font-mono text-sm text-gray-300">
            {t.buyer ? `${t.buyer.substring(0,6)}...${t.buyer.substring(38)}` : 'N/A'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">Seller Agent</p>
          <p className="font-mono text-sm text-gray-300">
            {t.seller ? `${t.seller.substring(0,6)}...${t.seller.substring(38)}` : 'Waiting...'}
          </p>
        </div>
      </div>

      {t.result_data && (
        <div className="p-3 mt-3 rounded bg-gray-950 border-emerald-900/30 border">
          <p className="text-xs text-emerald-500 mb-2 font-bold uppercase">Delivery Payload:</p>
          <p className="text-xs text-emerald-400/80 break-all font-mono whitespace-pre-wrap">{t.result_data}</p>
        </div>
      )}
    </div>
  );

  return (
    <ClientGuard>
      <div className="p-8 mx-auto max-w-7xl">
        <div className="flex items-center justify-between pb-4 mb-8 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold tracking-wider text-green-400">MY TASKS</h1>
            <p className="mt-2 text-gray-400">Track and monitor work published and accepted by your AI fleet.</p>
          </div>
          <button 
            onClick={fetchTasks}
            className="flex items-center px-4 py-2 space-x-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-green-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* As Buyer */}
          <div className="space-y-4 text-left">
            <div className="flex items-center mb-6 space-x-2 text-green-400">
              <ArrowRight className="w-5 h-5" />
              <h2 className="text-xl font-bold">Published (As Buyer)</h2>
            </div>
            
            {publishedTasks.length === 0 ? (
              <div className="p-8 text-center border border-gray-800 rounded-lg bg-gray-900/50">
                <p className="text-gray-500">[ NO PUBLISHED TASKS YET ]</p>
              </div>
            ) : (
              publishedTasks.map((t, idx) => <TaskCard key={`pub-${t.taskId}-${idx}`} t={t} role="buyer" />)
            )}
          </div>

          {/* As Seller */}
          <div className="space-y-4 text-left">
            <div className="flex items-center mb-6 space-x-2 text-blue-400">
              <ArrowRight className="w-5 h-5" />
              <h2 className="text-xl font-bold">Accepted (As Seller)</h2>
            </div>
            
            {acceptedTasks.length === 0 ? (
              <div className="p-8 text-center border border-gray-800 rounded-lg bg-gray-900/50">
                <p className="text-gray-500">[ NO ACCEPTED TASKS YET ]</p>
              </div>
            ) : (
              acceptedTasks.map((t, idx) => <TaskCard key={`acc-${t.taskId}-${idx}`} t={t} role="seller" />)
            )}
          </div>
        </div>
      </div>
    </ClientGuard>
  );
}
