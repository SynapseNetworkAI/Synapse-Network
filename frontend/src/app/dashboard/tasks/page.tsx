'use client';
import { useEffect, useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import ClientGuard from '@/components/ClientGuard';
import { RefreshCw, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { agentStore } from '@/utils/agentStore';

export default function MyTasksDashboard() {
  const { address } = useAccount();
  const router = useRouter(); // add router using new code
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Pagination and filtering states
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to page 1 on search
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchTasks = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString()
      });
      if (roleFilter !== 'all') {
        params.append('role', roleFilter);
      }
      if (debouncedSearch) {
        params.append('search', debouncedSearch);
      }
      
      const res = await fetch(`http://127.0.0.1:8000/api/client/fleet/tasks?${params.toString()}`, {
        headers: {
          "Authorization": "Bearer active",
          "X-User-Address": address
        }
      });
      const resData = await res.json();
      if (resData && typeof resData === 'object' && 'data' in resData) {
        setTasks(resData.data);
        setTotal(resData.total);
      } else {
        setTasks(Array.isArray(resData) ? resData : []);
        setTotal(Array.isArray(resData) ? resData.length : 0);
      }
    } catch (e) {
      console.error('Failed to fetch fleet tasks', e);
    } finally {
      setLoading(false);
    }
  }, [address, page, pageSize, roleFilter, debouncedSearch]);

  useEffect(() => {
    if (address) {
      fetchTasks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const fleetWallets = agentStore.getAgentsByOwner(address).map(a => a.address?.toLowerCase() || '');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getTaskRole = (t: any) => {
    const buyer = t.buyer?.toLowerCase();
    const seller = t.seller?.toLowerCase();
    const isBuyer = buyer && fleetWallets.includes(buyer);
    const isSeller = seller && fleetWallets.includes(seller);
    if (isBuyer && isSeller) return 'both';
    if (isBuyer) return 'buyer';
    if (isSeller) return 'seller';
    return 'unknown';
  };

  const totalPages = Math.ceil(total / pageSize);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TaskCard = ({ t }: { t: any }) => {
    const role = getTaskRole(t);
    const isBuyer = role === 'buyer' || role === 'both';
    
    return (
      <div className="w-full p-5 mb-4 transition-colors bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center mb-1 space-x-3">
              <h3 className="max-w-full text-xl font-bold text-white truncate">{t.title || 'Untitled Task'}</h3>
              <span className={`px-2 py-1 text-xs border rounded-full whitespace-nowrap ${getStatusColor(t.status)}`}>
                {t.status}
              </span>
              <span className={`px-2 py-1 text-xs border rounded-full whitespace-nowrap ${role === 'buyer' ? 'text-green-400 border-green-400/30 bg-green-400/10' : role === 'seller' ? 'text-blue-400 border-blue-400/30 bg-blue-400/10' : 'text-purple-400 border-purple-400/30 bg-purple-400/10'}`}>
                {role === 'buyer' ? 'Published' : role === 'seller' ? 'Accepted' : 'Internal'}
              </span>
              {t.blockNumber && (
                <span className="hidden text-xs text-gray-500 sm:inline-block">
                  Block: {t.blockNumber}
                </span>
              )}
            </div>
            <p className="max-w-3xl mt-2 text-sm text-gray-400 break-words">{t.description || 'No description provided'}</p>
          </div>
          <div className="flex flex-col items-end flex-shrink-0 text-right">
            <p className={`font-mono text-xl font-bold ${isBuyer ? 'text-red-400' : 'text-green-400'}`}>
              {isBuyer ? '-' : '+'}${parseFloat(t.amount || '0').toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-gray-500">ID: {t.taskId?.substring(0, 8)}...</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 gap-4 py-3 mt-4 border-t border-gray-800 md:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500 uppercase">Buyer Agent</p>
            <p className="font-mono text-sm text-gray-300 break-all">
              {t.buyer ? t.buyer : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Seller Agent</p>
            <p className="font-mono text-sm text-gray-300 break-all">
              {t.seller ? t.seller : 'Waiting...'}
            </p>
          </div>
        </div>
  
        {t.result_data && (
          <div className="p-3 mt-3 border rounded bg-gray-950 border-emerald-900/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase text-emerald-500">Delivery Payload:</p>
              <button
                onClick={() => router.push(`/dashboard/tasks/${t.taskId}`)}
                className="text-xs font-medium underline text-emerald-400 hover:text-emerald-300"
              >
                View Details
              </button>
            </div>
            <p className="font-mono text-xs truncate text-emerald-400/80">{t.result_data}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <ClientGuard>
      <div className="flex flex-col h-full p-4 mx-auto md:p-8 max-w-7xl">
        <div className="flex flex-col justify-between gap-4 pb-4 mb-6 border-b border-gray-800 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-wider text-green-400">MY TASKS</h1>
            <p className="mt-2 text-gray-400">Track and monitor work published and accepted by your AI fleet.</p>
          </div>
          <button 
            onClick={fetchTasks}
            className="flex items-center justify-center px-4 py-2 space-x-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-green-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col gap-4 p-4 mb-8 bg-gray-900 border border-gray-800 rounded-lg sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute w-5 h-5 text-gray-500 transform -translate-y-1/2 left-3 top-1/2" />
            <input
              type="text"
              placeholder="Search by task title, description, or agent address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-gray-200 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Filter className="flex-shrink-0 w-5 h-5 text-gray-500" />
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1); // reset to page 1 on filter change
              }}
              className="bg-gray-950 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-200 focus:outline-none focus:border-green-500"
            >
              <option value="all">All Roles</option>
              <option value="buyer">Published (As Buyer)</option>
              <option value="seller">Accepted (As Seller)</option>
            </select>
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 w-full">
          {loading && tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-gray-800 rounded-lg bg-gray-900/50">
              <RefreshCw className="w-8 h-8 mb-4 text-green-400 animate-spin" />
              <p className="text-gray-400">Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-12 text-center border border-gray-800 rounded-lg bg-gray-900/50">
              <p className="mb-2 text-lg text-gray-500">[ NO TASKS FOUND ]</p>
              <p className="text-sm text-gray-600">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {tasks.map((t, idx) => <TaskCard key={`task-${t.taskId}-${idx}`} t={t} />)}
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {total > 0 && (
          <div className="flex items-center justify-between p-4 mt-8 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="text-sm text-gray-400">
              Showing <span className="font-bold text-white">{(page - 1) * pageSize + 1}</span> to <span className="font-bold text-white">{Math.min(page * pageSize, total)}</span> of <span className="font-bold text-white">{total}</span> tasks
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="p-2 transition-colors bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous Page"
              >
                <ChevronLeft className="w-5 h-5 text-gray-300" />
              </button>
              
              <div className="flex items-center px-4 font-mono text-sm text-gray-300 border border-gray-800 rounded bg-gray-950">
                Page {page} / {totalPages || 1}
              </div>
              
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-2 transition-colors bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next Page"
              >
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </button>
            </div>
          </div>
        )}
      </div>
    </ClientGuard>
  );
}
