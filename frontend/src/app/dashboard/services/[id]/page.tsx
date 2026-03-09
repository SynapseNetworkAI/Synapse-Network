"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { 
  ArrowLeft, Copy, Check, ShieldAlert, Cpu, Wallet, Trash2, 
  ArrowUpRight, ArrowDownRight, Activity
} from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import Link from "next/link";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import PaidInvokePanel from "@/components/PaidInvokePanel";
import { listServiceRegistry } from "@/utils/serviceApi";
import { buildAuthedHeaders } from "@/utils/authSession";

export default function ServiceDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { address: userAddress } = useAccount();
  
  const [service, setService] = useState<AgentIdentity | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedFastapi, setCopiedFastapi] = useState(false);
  const [copiedFetchSnippet, setCopiedFetchSnippet] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [primaryService, setPrimaryService] = useState<{
    serviceId: string;
    pricing: string;
    endpoint: string;
    isActive: boolean;
  } | null>(null);
  
  // Real Balance state
  const [serviceBalance, setServiceBalance] = useState("0.00");
  const [currentPage, setCurrentPage] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [txHistory, setTxHistory] = useState<any[]>([]);
  const [serviceStats, setServiceStats] = useState({ revenue: 0, expense: 0 });

  useEffect(() => {
    const data = agentStore.getAgent(id);
    if (!data) {
      router.push("/dashboard");
      return;
    }

    setService(data);
    fetchRealBalance(data.address);

    if (userAddress) {
      fetchTransactions(data.address, userAddress);
      void (async () => {
        try {
          const rows = await listServiceRegistry(userAddress, userAddress);
          const selected = rows
            .filter((row) =>
              row.agentId
                ? row.agentId === data.id
                : row.address.toLowerCase() === data.address.toLowerCase()
            )
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];

          setPrimaryService(
            selected
              ? {
                  serviceId: selected.serviceId,
                  pricing: selected.pricing,
                  endpoint: selected.endpoint,
                  isActive: selected.isActive,
                }
              : null
          );
        } catch {
          setPrimaryService(null);
        }
      })();
    }
  }, [id, router, userAddress]);

  const fetchTransactions = async (address: string, owner: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/client/tasks?agent=${address}`, {
        headers: {
          ...buildAuthedHeaders(owner, false),
        }
      });
      if (res.ok) {
        const data = await res.json();
        setTxHistory(data);
        
        // Compute stats for 24h mock replacement
        let rev = 0;
        let exp = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.forEach((t: any) => {
          const amt = Number.parseFloat(t.amount || "0");
          if (t.status === "RELEASED" || t.status === "COMPLETED" || t.status === "LOCKED") {
            if (t.seller?.toLowerCase() === address.toLowerCase()) rev += amt;
            if (t.buyer?.toLowerCase() === address.toLowerCase()) exp += amt;
          }
        });
        setServiceStats({ revenue: rev, expense: exp });
      } else {
        console.error("Backend validation failed", await res.text());
        setTxHistory([]);
      }
    } catch (e) {
      console.error("Failed to fetch transactions", e);
    }
  };

  const fetchRealBalance = async (address: string) => {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);
      
      const bal = await usdcContract.balanceOf(address);
      setServiceBalance(Number.parseFloat(ethers.formatUnits(bal, 18)).toFixed(2));
    } catch(err) {
      console.error("Failed to fetch real on-chain service balance", err);
    }
  };

  const copyToClipboard = (text: string, type: 'key' | 'addr') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 2000);
    }
  };

  const copySnippet = (text: string, type: "fastapi" | "fetch") => {
    navigator.clipboard.writeText(text);
    if (type === "fastapi") {
      setCopiedFastapi(true);
      setTimeout(() => setCopiedFastapi(false), 2000);
      return;
    }
    setCopiedFetchSnippet(true);
    setTimeout(() => setCopiedFetchSnippet(false), 2000);
  };

  const serviceId = primaryService?.serviceId || "";
  const pricing = primaryService?.pricing || "0.05";
  const endpoint = primaryService?.endpoint || "";
  const isActive = primaryService?.isActive ?? true;


  const fastApiBoilerplate = `from fastapi import FastAPI, Header, HTTPException\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nSERVICE_ID = "${serviceId || "YOUR_SERVICE_ID"}"\nPRICE_USDC = "${pricing || "0.05"}"\nPROVIDER_WALLET = "${service?.address || "0x..."}"\n\nclass ServiceRequest(BaseModel):\n    input: str\n\n@app.post("/service")\nasync def run_service(payload: ServiceRequest, x_service_id: str = Header(default="")):\n    if x_service_id != SERVICE_ID:\n        raise HTTPException(status_code=403, detail="Invalid service id")\n\n    return {\n        "service_id": SERVICE_ID,\n        "price_usdc": PRICE_USDC,\n        "provider_wallet": PROVIDER_WALLET,\n        "result": f"processed: {payload.input}"\n    }`;

  const buyerFetchSnippet = `import { invokePaidService } from "@/utils/invokePaidService";\nimport { payForServiceWithApproval } from "@/utils/payForService";\n\nconst seller = "${service?.address || "0x..."}" as \`0x\${string}\`;\nconst serviceId = "${serviceId || "YOUR_SERVICE_ID"}";\nconst priceUsdc = "${pricing || "0.05"}";\n\nconst result = await invokePaidService({\n  endpoint: "${endpoint || "https://api.my-agent.com/service"}",\n  serviceId,\n  payload: { input: "hello" },\n  payForService: async () =>\n    payForServiceWithApproval({\n      seller,\n      serviceId,\n      priceUsdc,\n      rpcUrl: "http://127.0.0.1:8545"\n    }),\n  maxWaitMs: 60000,\n  defaultRetryAfterMs: 2000,\n  maxAttempts: 20\n});\n\nconsole.log("txHash:", result.txHash);\nconsole.log("attempts:", result.attempts);\nconsole.log("service response:", result.response);\n\n// router: ${contractConfig.A2APaySyncRouter}\n// token: ${contractConfig.MockUSDC}`;

  const deleteService = () => { toast((t) => ( <div className="max-w-full p-6 font-mono text-left bg-gray-900 border-2 rounded-lg border-red-500/50 w-80"> <h3 className="mt-0 mb-2 text-xl font-bold tracking-wider text-red-400 uppercase">WARNING</h3> <p className="mb-6 text-sm leading-relaxed text-gray-300"> Are you sure you want to delete this service? The private key will be lost forever if not backed up. </p> <div className="flex gap-3"> <button onClick={() => {toast.dismiss(t.id); agentStore.removeAgent(id); router.push("/dashboard");}} className="flex-1 py-2 text-sm tracking-wide text-red-300 uppercase transition-colors border rounded cursor-pointer bg-red-900/40 hover:bg-red-900/80 border-red-500/30">DELETE</button> <button onClick={() => toast.dismiss(t.id)} className="flex-1 py-2 text-sm tracking-wide text-gray-200 uppercase transition-colors bg-gray-800 border border-gray-600 rounded cursor-pointer hover:bg-gray-700">CANCEL</button> </div> </div> ), { duration: Infinity, style: { background: "transparent", boxShadow: "none", padding: 0 } }); };

  if (!service) return <div className="p-8 text-center text-gray-500">Loading Service Data...</div>;

  return (
    <div className="max-w-6xl p-8 mx-auto">
      <Link href="/dashboard" className="flex inline-flex items-center mb-8 text-gray-400 transition-colors hover:text-white">
        <ArrowLeft className="w-4 h-4 mr-2" /> back to services
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        
        {/* Left Column: Identity, Financials & Keys */}
        <div className="space-y-6 lg:col-span-2">
          
          {/* Header Card */}
          <div className="flex flex-col justify-between gap-4 p-6 bg-black border border-green-900/50 rounded-2xl md:flex-row md:items-center">
            <div className="flex items-center">
              <Cpu className="w-10 h-10 mr-4 text-green-500" />
              <div>
                <h1 className="text-3xl font-black leading-none text-white">{service.name}</h1>
                <span className="font-mono text-sm tracking-wider text-green-400">{service.role}</span>
              </div>
            </div>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 px-4 py-2 text-right bg-gray-900 border border-gray-800 rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">On-Chain USDC</div>
                <div className="font-mono text-xl font-bold text-green-400">${serviceBalance}</div>
              </div>
              <button onClick={deleteService} className="flex items-center justify-center p-3 text-red-500 transition-colors border rounded-lg hover:bg-red-500/10 border-red-900/30" title="Decommission Service">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Financials Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 bg-black border border-gray-800 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-400">Total Revenue</span>
                <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-400">{`+$${serviceStats.revenue.toFixed(2)}`}</div>
            </div>
            <div className="p-5 bg-black border border-gray-800 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-400">Total Expense & Gas</span>
                <ArrowDownRight className="w-4 h-4 text-red-400" />
              </div>
              <div className="text-2xl font-bold text-red-400">{`-$${serviceStats.expense.toFixed(2)}`}</div>
            </div>
          </div>

          {/* Keys & Address */}
          <div className="relative p-6 overflow-hidden border border-gray-800 bg-black/60 rounded-2xl">
            <h3 className="flex items-center mb-4 text-lg font-bold text-white">
              <Wallet className="w-5 h-5 mr-2 text-gray-400" />
              Cryptographic Identity
            </h3>
            
            {/* Address */}
            <div className="mb-5">
              <span className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">Public Address</span>
              <div className="flex items-center group">
                <code id="public-address" className="flex-1 p-3 text-sm text-green-400 truncate border border-gray-800 rounded-l-lg bg-gray-900/80">
                  {service.address}
                </code>
                <button 
                  aria-describedby="public-address"
                  onClick={() => copyToClipboard(service.address, 'addr')}
                  className="p-3 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
                >
                  {copiedAddr ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Private Key */}
            <div>
              <span className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">
                Service Wallet Private Key (Python SDK Auth)
              </span>
              <div className="flex items-start p-3 mb-3 border bg-red-950/20 border-red-900/40 rounded-xl">
                <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                <p className="text-xs text-red-300">
                  CRITICAL: Do not share. Copy this to your python <code>.env</code> file.
                </p>
              </div>
              
              <div className="flex items-center h-12">
                <div className="relative flex items-center flex-1 h-full px-3 py-3 overflow-hidden border border-gray-800 rounded-l-lg bg-gray-900/80">
                  <div className={`font-mono text-sm break-all ${showKey ? 'text-red-400' : 'text-gray-600 blur-sm select-none'}`}>
                    {service.privateKey}
                  </div>
                  {!showKey && (
                     <button
                        type="button"
                        aria-label="Reveal private key"
                        className="absolute inset-0 z-10 flex items-center justify-center transition-colors cursor-pointer hover:bg-white/5"
                        onClick={() => setShowKey(true)}
                     >
                       <span className="px-3 py-1 text-xs font-bold text-gray-300 border border-gray-700 rounded bg-black/90">Click to reveal</span>
                     </button>
                  )}
                </div>
                <button 
                  onClick={() => copyToClipboard(service.privateKey, 'key')}
                  className="flex items-center justify-center h-full px-4 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
                >
                  {copiedKey ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          
          {/* Service Payment Ledger */}
          <div className="flex flex-col border border-[#00FFA3]/30 bg-[#060606] shadow-[0_0_20px_rgba(0,255,163,0.05)] rounded-xl overflow-hidden mt-6">
            <div className="flex items-center justify-between px-4 py-3 bg-[#0a2010] border-b border-[#00FFA3]/30">
              <h3 className="flex items-center text-sm font-bold tracking-wider text-[#00FFA3] uppercase font-mono">
                <Activity className="w-4 h-4 mr-2" />
                Service Payment Ledger
              </h3>
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
              </div>
            </div>
            
            <div className="p-4 font-mono text-xs md:text-sm overflow-x-auto whitespace-nowrap min-h-[400px]">
              <div className="grid grid-cols-[100px_minmax(140px,1fr)_120px_180px_100px] gap-4 pb-2 mb-2 text-[#00FFA3]/60 border-b border-[#00FFA3]/30 font-semibold tracking-wider">
                <div>TYPE</div>
                <div>COUNTERPARTY</div>
                <div>AMOUNT</div>
                <div>TASK DETAILS</div>
                <div>STATUS</div>
              </div>
              
              <div className="space-y-1">
                {txHistory.length > 0 ? txHistory.slice((currentPage - 1) * 8, currentPage * 8).map(tx => {
                  const isReceive = tx.seller.toLowerCase() === service?.address.toLowerCase();
                  const typeLabel = isReceive ? "INCOME " : "EXPENSE";
                  const typeColor = isReceive ? "text-[#00FFA3]" : "text-red-400";
                  const counterparty = isReceive ? tx.buyer : tx.seller;
                  const shortCp = `${counterparty.substring(0,6)}...${counterparty.substring(38)}`;
                  const prefix = isReceive ? "+" : "-";
                  const mockTaskType = isReceive ? "Data Service Provided" : "Compute API Call";
                  
                  return (
                    <div key={tx.taskId} className="grid grid-cols-[100px_minmax(140px,1fr)_120px_180px_100px] gap-4 py-2 hover:bg-[#00FFA3]/10 transition-colors rounded items-center">
                      <div className={`${typeColor} font-bold`}>[{typeLabel}]</div>
                      <div className="text-gray-400"><span className="mr-1 text-gray-600">{isReceive ? "FR:" : "TO:"}</span>{shortCp}</div>
                      <div className={`${typeColor}`}>{prefix}{tx.amount} USDC</div>
                      <div className="text-xs truncate text-blue-400/80" title={mockTaskType}>{mockTaskType}</div>
                      <div className="flex items-center text-xs text-gray-500">
                        {tx.status === "COMPLETED" ? <span className="text-[#00FFA3] mr-1">■</span> : <span className="mr-1 text-yellow-500">■</span>}
                        {tx.status}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-20 text-center text-[#00FFA3]/30">
                    <span className="animate-pulse">&gt;_ DATABASE_EMPTY</span>
                  </div>
                )}
              </div>
            </div>

            {/* Pagination */}
            {txHistory.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#00FFA3]/30 bg-black">
                <span className="font-mono text-xs text-[#00FFA3]/50">
                  {txHistory.length} query match(es)
                </span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 font-mono text-xs text-[#00FFA3] border border-[#00FFA3]/50 rounded hover:bg-[#00FFA3]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    &lt; PREV
                  </button>
                  <span className="px-3 py-1 font-mono text-xs text-[#00FFA3]">
                    PG {currentPage} / {Math.max(1, Math.ceil(txHistory.length / 8))}
                  </span>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(txHistory.length / 8), p + 1))}
                    disabled={currentPage === Math.ceil(txHistory.length / 8)}
                    className="px-3 py-1 font-mono text-xs text-[#00FFA3] border border-[#00FFA3]/50 rounded hover:bg-[#00FFA3]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    NEXT &gt;
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Funding */}
        <div className="space-y-6">
          <div className="flex flex-col items-center p-6 text-center border border-green-500/20 bg-green-500/5 rounded-2xl">
            <h3 className="mb-2 text-sm font-bold tracking-widest text-white uppercase">Fund Service Wallet</h3>
            <p className="mb-6 text-xs text-gray-400">Scan to deposit USDC or Native ETH (Gas) to this service execution wallet.</p>
            
            <div className="bg-white p-4 rounded-xl inline-block mb-6 shadow-[0_0_30px_rgba(34,197,94,0.15)]">
               <QRCodeSVG value={service.address} size={160} level="H" />
            </div>
            
            <div className="w-full px-3 py-2 font-mono text-xs text-gray-400 break-all border border-gray-800 rounded bg-black/40">
                {service.address}
            </div>

            <div className="w-full mt-6 space-y-3">
               <button className="w-full py-3 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400">
                 Deposit from Master Wallet
               </button>
               <button className="w-full py-3 text-sm font-bold text-green-500 transition-colors bg-transparent border rounded-lg border-green-500/30 hover:bg-green-500/10">
                 Sweep Funds to Master
               </button>
            </div>
          </div>

          <div className="p-6 border border-gray-800 rounded-2xl bg-black/60">
            <h3 className="mb-4 text-sm font-bold tracking-widest text-white uppercase">Service Configuration</h3>
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Agent settings and service configuration are separated. Manage service config in the dedicated Server Management page.
              </p>
              <Link
                href="/dashboard/services"
                className="inline-flex items-center justify-center w-full py-2 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
              >
                Open Server Management
              </Link>
            </div>
          </div>

          <div className="p-6 border border-gray-800 rounded-2xl bg-black/60">
            <h3 className="mb-4 text-sm font-bold tracking-widest text-white uppercase">Integration Docs</h3>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500 uppercase">FastAPI Boilerplate</span>
                  <button
                    type="button"
                    onClick={() => copySnippet(fastApiBoilerplate, "fastapi")}
                    className="text-xs text-green-400 hover:text-green-300"
                  >
                    {copiedFastapi ? "Copied" : "Copy"}
                  </button>
                </div>
                <textarea
                  value={fastApiBoilerplate}
                  readOnly
                  className="w-full h-48 p-3 font-mono text-xs text-green-300 border border-gray-800 rounded-lg bg-gray-950"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500 uppercase">Buyer Fetch Snippet</span>
                  <button
                    type="button"
                    onClick={() => copySnippet(buyerFetchSnippet, "fetch")}
                    className="text-xs text-green-400 hover:text-green-300"
                  >
                    {copiedFetchSnippet ? "Copied" : "Copy"}
                  </button>
                </div>
                <textarea
                  value={buyerFetchSnippet}
                  readOnly
                  className="w-full p-3 font-mono text-xs text-green-300 border border-gray-800 rounded-lg h-44 bg-gray-950"
                />
              </div>
            </div>
          </div>

          <PaidInvokePanel
            sellerAddress={service.address}
            endpoint={endpoint}
            serviceId={serviceId}
            pricing={pricing}
            isActive={isActive}
            title="Live Test (Pay + Invoke)"
          />
        </div>

      </div>
    </div>
  );
}
