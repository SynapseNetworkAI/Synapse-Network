"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Server, Plus, Activity, Key } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { listServiceRegistry } from "@/utils/serviceApi";

export default function ServicesPage() {
  const { address } = useAccount();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadServices = async () => {
      try {
        const data = await listServiceRegistry(address as string, address as string);
        setServices(data);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load services");
      } finally {
        setLoading(false);
      }
    };

    if (address) {
      void loadServices();
    } else {
      setLoading(false);
    }
  }, [address]);

  return (
    <div className="p-8 mx-auto space-y-8 max-w-7xl">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <Server className="mr-3 text-green-400" />
            Seller Management
          </h1>
          <p className="mt-2 text-gray-400">Manage your deployed API manifests and secret keys.</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="flex items-center px-4 py-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Dashboard
          </Link>
          <Link 
            href="/dashboard/services/deploy"
            className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
          >
            <Plus className="w-5 h-5 mr-2" />
            Deploy Manifest
          </Link>
        </div>
      </div>

      {!address ? (
        <div className="p-8 text-center border border-gray-800 rounded-xl bg-black/40">
          <p className="text-gray-400">Please connect your wallet to manage services.</p>
        </div>
      ) : loading ? (
        <div className="p-8 text-center text-green-400 animate-pulse">Loading Synapses...</div>
      ) : services.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-gray-800 rounded-xl bg-black/20">
          <Server className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="mb-2 text-xl font-bold text-white">No Services Found</h3>
          <p className="mb-6 text-gray-400">You haven&apos;t deployed any Service Manifests yet.</p>
          <Link 
            href="/dashboard/services/deploy"
            className="inline-flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
          >
            <Plus className="w-5 h-5 mr-2" />
            Deploy Your First API
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {services.map((svc) => (
            <div key={svc.id} className="p-6 border border-gray-800 rounded-xl bg-gray-900/50 hover:border-green-500/50 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="flex items-center text-xl font-bold text-white">
                    {svc.name}
                    <span className={`ml-3 px-2 py-1 text-xs rounded-full ${svc.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      {svc.isActive ? "Active" : "Offline"}
                    </span>
                  </h3>
                  <p className="mt-1 font-mono text-sm text-gray-400">{svc.serviceId}</p>
                </div>
                <button className="p-2 text-gray-400 transition-colors hover:text-green-400" title="View Secret Key">
                  <Key className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mb-6 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Endpoint</span>
                  <span className="text-gray-300 font-mono truncate max-w-[200px]">{svc.endpoint}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Pricing</span>
                  <span className="font-mono text-green-400">{svc.pricing} USDC</span>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button className="flex-1 px-4 py-2 font-bold text-white transition bg-gray-800 rounded hover:bg-gray-700 text-sm">
                  Edit Manifest
                </button>
                <button className="flex items-center justify-center flex-1 px-4 py-2 text-sm font-bold text-green-400 transition border border-green-500/30 rounded hover:bg-green-500/10">
                  <Activity className="w-4 h-4 mr-2" />
                  Metrics
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
