"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Server, Plus, Activity, ShieldAlert, RefreshCw, X, CheckCircle2, ShieldCheck, Copy } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { listServiceRegistry, rotateServiceKey, testServicePing } from "@/utils/serviceApi";

export default function ServicesPage() {
  const { address } = useAccount();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Security Modal State
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [selectedService, setSelectedService] = useState<any | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [newUnmaskedKey, setNewUnmaskedKey] = useState<string | null>(null);
  const [pingSuccess, setPingSuccess] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (address) {
      void loadServices();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const handleRotateKey = async () => {
    if (!address || !selectedService) return;
    
    if (!confirm("🚨 WARNING: Rotating this key will immediately invalidate the old key. Any inflight API requests to your server using the old key will be rejected. Are you sure?")) {
      return;
    }

    setIsRotating(true);
    setNewUnmaskedKey(null);
    setPingSuccess(null);
    try {
      const res = await rotateServiceKey(selectedService.id, address);
      setNewUnmaskedKey(res.secretKey);
      
      // Update local state mask 
      setServices(prev => prev.map(s => s.id === selectedService.id ? { ...s, maskedKey: res.maskedKey } : s));
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      setSelectedService((prev: any) => ({ ...prev, maskedKey: res.maskedKey }));
      
      toast.success("Secret Key Rotated Successfully");
    } catch (err: unknown) {
      toast.error("Failed to rotate key: " + String((err as Error)?.message || err));
    } finally {
      setIsRotating(false);
    }
  };

  const handlePing = async () => {
    if (!address || !selectedService) return;
    setIsPinging(true);
    setPingSuccess(null);
    try {
      await testServicePing(selectedService.id, address);
      setPingSuccess(true);
      toast.success("Connection OK! Verification Passed.");
    } catch (err: unknown) {
      setPingSuccess(false);
      toast.error("Ping Failed: " + String((err as Error)?.message || err));
    } finally {
      setIsPinging(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const closeSecurityModal = () => {
    setSelectedService(null);
    setNewUnmaskedKey(null);
    setPingSuccess(null);
  };

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
                <button 
                  onClick={() => setSelectedService(svc)}
                  className="p-2 text-yellow-500/70 transition-colors border border-yellow-500/20 rounded bg-yellow-500/10 hover:bg-yellow-500/30 hover:text-yellow-400" 
                  title="Security & Auth Settings"
                >
                  <ShieldAlert className="w-5 h-5" />
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

      {/* Security Modal */}
      {selectedService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in" style={{ animationDuration: '200ms' }}>
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 shadow-2xl rounded-2xl overflow-hidden shadow-yellow-900/20">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-800">
              <h2 className="flex items-center text-xl font-bold text-white">
                <ShieldAlert className="w-6 h-6 mr-3 text-yellow-500" />
                Security & Auth
              </h2>
              <button onClick={closeSecurityModal} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-8">
              {/* Context */}
              <div>
                <p className="text-sm font-mono text-gray-400 mb-1">Target Service</p>
                <p className="text-lg font-bold text-white">{selectedService.name}</p>
                <p className="text-xs text-yellow-500/80 mt-1">This panel manages the HMAC Gateway Secret Key used to defend your endpoint from direct unauthorized access.</p>
              </div>

              {/* Show Once New Key State */}
              {newUnmaskedKey ? (
                <div className="p-4 border border-green-500 bg-green-900/20 rounded-xl space-y-3">
                  <div className="flex items-center text-green-400 font-bold">
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    New Secret Key Generated
                  </div>
                  <p className="text-sm text-gray-300">Copy this key immediately and update your server environment variables. This will not be shown again.</p>
                  <div className="flex items-center justify-between p-3 font-mono text-sm text-green-400 bg-black/60 border border-green-700/50 rounded-lg">
                    <span className="truncate mr-4">{newUnmaskedKey}</span>
                    <button 
                      onClick={() => copyToClipboard(newUnmaskedKey)}
                      className="p-1.5 text-gray-400 transition-colors hover:text-green-400"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Standard State (Masked) */
                <div className="p-4 border border-gray-800 bg-black/40 rounded-xl space-y-2">
                  <p className="text-sm font-bold text-gray-300">Current Key Fingerprint</p>
                  <div className="flex items-center font-mono text-xl text-gray-500 tracking-wider">
                    {selectedService.maskedKey || "sk_live_********"}
                  </div>
                  <p className="text-xs text-gray-500">For security reasons, the full secret key is permanently hidden after creation.</p>
                </div>
              )}

              {/* Actions */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  onClick={handlePing}
                  disabled={isPinging}
                  className="flex flex-col items-center justify-center p-4 transition-colors border border-gray-700 rounded-xl bg-gray-800/50 hover:bg-gray-800 hover:border-gray-500 disabled:opacity-50"
                >
                  <ShieldCheck className={`w-6 h-6 mb-2 ${pingSuccess === true ? "text-green-400" : pingSuccess === false ? "text-red-400" : "text-gray-400"}`} />
                  <span className="text-sm font-bold text-white">Test Connection</span>
                  <span className="text-xs text-gray-500 mt-1 text-center">Send HMAC Ping</span>
                </button>
                
                <button
                  onClick={handleRotateKey}
                  disabled={isRotating}
                  className="flex flex-col items-center justify-center p-4 transition-colors border border-red-900/50 rounded-xl bg-red-900/10 hover:bg-red-900/30 hover:border-red-500/50 group disabled:opacity-50"
                >
                  <RefreshCw className={`w-6 h-6 mb-2 text-red-500 group-hover:text-red-400 ${isRotating ? "animate-spin" : ""}`} />
                  <span className="text-sm font-bold text-red-400">Rotate Key</span>
                  <span className="text-xs text-red-500/60 mt-1 text-center">Invalidate old key</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
