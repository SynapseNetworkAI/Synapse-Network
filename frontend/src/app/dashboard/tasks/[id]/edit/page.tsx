'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ArrowLeft, Save, Loader2, AlertCircle } from 'lucide-react';
import ClientGuard from '@/components/ClientGuard';

export default function EditTaskPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { address } = useAccount();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

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
          if (data.status !== 'PENDING') {
            setError('Task is no longer PENDING and cannot be edited. Please go back and cancel it if you wish to recreate it.');
          } else {
            setTitle(data.title || '');
            setAmount(data.amount || '');
            setDescription(data.description || '');
          }
        } else {
          setError('Failed to load task or task not found.');
        }
      } catch (err) {
        console.error(err);
        setError('Connection error while fetching task.');
      } finally {
        setLoading(false);
      }
    };
    if (address && params.id) {
      fetchTask();
    }
  }, [address, params.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/client/tasks/${params.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer active",
          "X-User-Address": address || ""
        },
        body: JSON.stringify({
          title,
          amount: amount.toString(),
          description
        })
      });
      if (res.ok) {
        router.push('/dashboard/tasks');
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to update task');
      }
    } catch (err) {
      console.error(err);
      setError('Connection error while saving task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ClientGuard>
      <div className="max-w-3xl p-4 mx-auto md:p-8">
        <button
          onClick={() => router.back()}
          className="flex items-center mb-6 text-sm text-gray-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </button>

        <div className="p-6 bg-gray-900 border border-gray-800 shadow-lg rounded-xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white">Edit Task</h1>
            <p className="mt-1 text-sm text-gray-400">
              Only tasks in the <span className="text-yellow-400">PENDING</span> state can be modified. Funds have not been locked yet.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 mb-6 border rounded-lg bg-red-500/10 border-red-500/20">
              <div className="flex items-center text-red-500">
                <AlertCircle className="flex-shrink-0 w-5 h-5 mr-3" />
                <p>{error}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-300">Task Title</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Generate 5 UI components"
                />
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
                    className="w-full pl-8 pr-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="50.00"
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">Since no funds have been committed to the smart contract yet, changing the amount is free and requires no gas.</p>
              </div>

              <div>
                <label className="block mb-2 text-sm font-medium text-gray-300">Task Description / Requirements</label>
                <textarea
                  required
                  rows={5}
                  className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 text-white rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe exactly what needs to be done..."
                />
              </div>

              <div className="flex justify-end pt-6 mt-6 space-x-4 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="px-6 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </ClientGuard>
  );
}
