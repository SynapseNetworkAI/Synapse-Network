"use client";

import { useState, useEffect } from "react";
import { Key, ShieldCheck, Activity, Copy, CheckCircle2, FileCode2, Plus, Trash2, Info, X } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/components/WalletAuthGuard";

import { listApiSecrets, createApiSecret, deleteApiSecret, ProviderSecret } from "@/utils/serviceApi";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export default function SecretsPage() {
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  const [secrets, setSecrets] = useState<ProviderSecret[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"python" | "node" | "java">("node");
  const [loading, setLoading] = useState(false);
  const [newSecretName, setNewSecretName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [qpsLimit, setQpsLimit] = useState<string>("");
  const [expiration, setExpiration] = useState("Never");
  
  useEffect(() => {
    async function init() {
      if (!address || !isSessionAuthenticated) {
        setSecrets([]);
        return;
      }
      try {
        setLoading(true);
        const data = await listApiSecrets(address as string);
        setSecrets(data || []);
      } catch (error: unknown) { console.error('ERROR Loading secrets:', error);
        const msg = getErrorMessage(error);
        if (!msg.includes("Wallet auth") && !msg.toLowerCase().includes("token expired")) {
          toast.error(`Failed to load secrets: ${msg}`);
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [address, isSessionAuthenticated]);

  const handleCreateSecret = async () => {
    if (!address || !isSessionAuthenticated) {
      toast("Please sign in with wallet session first.", { icon: "🔐" });
      return;
    }
    const finalName = newSecretName.trim() || `Secret Key ${secrets.length + 1}`;
    try {
      setIsCreating(true);
      const rpm = qpsLimit.trim() ? Number.parseInt(qpsLimit, 10) : null;
      const expirationDays = expiration === "Never" ? null : Number.parseInt(expiration, 10);
      const expirationTs = expirationDays && expirationDays > 0
        ? Math.floor(Date.now() / 1000) + expirationDays * 24 * 3600
        : null;

      const newSecret = await createApiSecret(finalName, address as string, null, null, expirationTs, rpm);
      
      setSecrets([newSecret, ...secrets]);
      toast.success("Secret created successfully");
      setNewSecretName("");
      setQpsLimit("");
      setExpiration("Never");
      setIsModalOpen(false);
    } catch (error: unknown) { console.error('ERROR Loading secrets:', error);
      const msg = getErrorMessage(error);
      if (!msg.includes("Wallet auth") && !msg.toLowerCase().includes("token expired")) {
        toast.error(`Failed to create secret: ${msg}`);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSecret = async (id: string) => {
    if (!address || !isSessionAuthenticated) {
      toast("Please sign in with wallet session first.", { icon: "🔐" });
      return;
    }
    if (!confirm("Are you sure you want to delete this secret key? Any services using it will be blocked.")) return;
    try {
      await deleteApiSecret(id, address as string);
      setSecrets(secrets.filter(s => s.id !== id));
      toast.success("Secret deleted");
    } catch (error: unknown) { console.error('ERROR Loading secrets:', error);
      toast.error("Failed to delete secret");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("API Key copied");
    setTimeout(() => setCopied(null), 2000);
  };

  const handleOpenCreateSecretModal = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!isSessionAuthenticated) {
      const ok = await authorize();
      if (!ok) {
        return;
      }
    }

    setIsModalOpen(true);
  };

  let secretListContent: React.ReactNode;
  if (loading) {
    secretListContent = (
      <div className="text-center py-8 text-gray-500 font-mono animate-pulse">
        Loading secrets...
      </div>
    );
  } else if (secrets.length === 0) {
    secretListContent = (
      <div className="text-center py-8 text-gray-500 font-mono">
        {address
          ? "No secrets generated yet. Create one to secure your endpoints."
          : "No secrets available. Connect your wallet and sign in to create one."}
      </div>
    );
  } else {
    secretListContent = (
      <div className="space-y-4">
        {secrets.map(sec => (
          <div key={sec.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-gray-950/50 border border-gray-800/80 rounded-lg group hover:border-green-500/30 transition-colors">
            <div className="flex md:items-center gap-4 mb-4 md:mb-0">
              <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                <Key className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h3 className="text-white font-medium">{sec.name}</h3>
                <div className="text-xs text-gray-400 font-mono mt-1 flex items-center gap-2">
                  Created: {new Date(sec.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4 bg-gray-900 px-4 py-2 rounded-md border border-gray-800">
                <span className="font-mono text-sm text-emerald-400 tracking-wider">
                  {sec.secretKey || sec.maskedKey}
                </span>
                {sec.secretKey && (
                  <button
                    onClick={() => copyToClipboard(sec.secretKey, sec.id)}
                    className="text-gray-500 hover:text-white transition-colors"
                    title="Copy Original Key"
                  >
                    {copied === sec.id ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                )}
              </div>

              <button
                onClick={() => handleDeleteSecret(sec.id)}
                className="p-2 text-gray-500 hover:text-red-400 transition-colors border border-transparent hover:border-red-900/50 rounded hover:bg-red-900/20"
                title="Revoke Key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1C1C1C] border border-gray-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">Generate keys</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Name Field */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="secret-name" className="text-sm font-medium text-gray-200">Name</label>
                  <div className="group relative flex items-center">
                    <Info className="w-4 h-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-xs text-gray-200 rounded shadow-lg border border-gray-700 z-10">
                      Choose a clear and descriptive name for this API key.
                    </div>
                  </div>
                </div>
                <input 
                  id="secret-name"
                  type="text" 
                  value={newSecretName}
                  onChange={(e) => setNewSecretName(e.target.value)}
                  placeholder="e.g. My Next.js App"
                  className="w-full bg-[#0A0A0A] border border-gray-800 px-3 py-2 rounded-md text-sm text-white focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none transition-all placeholder:text-gray-600"
                />
              </div>

              {/* QPS Limit Field */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="secret-qps" className="text-sm font-medium text-gray-200">qps</label>
                  <div className="group relative flex items-center">
                    <Info className="w-4 h-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-xs text-gray-200 rounded shadow-lg border border-gray-700 z-10">
                      Set a maximum Queries Per Second limit. Leave empty for unlimited.
                    </div>
                  </div>
                </div>
                <div className="relative">
                  <input 
                    id="secret-qps"
                    type="number" 
                    value={qpsLimit}
                    onChange={(e) => setQpsLimit(e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full bg-[#0A0A0A] border border-gray-800 px-3 py-2 rounded-md text-sm text-white focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Expiration Field */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="secret-expiration" className="text-sm font-medium text-gray-200">Expiration</label>
                  <div className="group relative flex items-center">
                    <Info className="w-4 h-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-xs text-gray-200 rounded shadow-lg border border-gray-700 z-10">
                      Select when you want this API key to expire for security.
                    </div>
                  </div>
                </div>
                <select 
                  id="secret-expiration"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-gray-800 px-3 py-2 rounded-md text-sm text-white focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none transition-all appearance-none"
                >
                  <option value="Never">Never</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
            </div>

            <div className="p-5 border-t border-gray-800 flex justify-end gap-3 bg-gray-900/50">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                disabled={isCreating}
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateSecret}
                disabled={isCreating || !newSecretName.trim()}
                className="px-6 py-2 bg-white hover:bg-gray-200 text-black font-semibold rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    <div className="max-w-7xl mx-auto space-y-8 p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header */}
      <div className="flex justify-between items-start border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight text-white mb-2 flex items-center gap-3">
            <Key className="w-8 h-8 text-green-400" />
            Provider API Secrets
          </h1>
          <p className="text-gray-400 max-w-2xl">
            API Secrets serve as master keys for your provider node. A single secret can authorize calls to all of your registered services.
          </p>
        </div>
      </div>

      {/* Secrets List Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden backdrop-blur-sm">
        <div className="p-6 border-b border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-mono text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Active Service Keys
          </h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleOpenCreateSecretModal}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-black font-semibold rounded-md text-sm transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create new secret key
            </button>
          </div>
        </div>
        <div className="p-6">
          {secretListContent}
        </div>
      </div>

      {/* Developer Integration Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Explanations */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-mono text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-400" />
              How It Works
            </h3>
            <div className="space-y-4 text-sm text-gray-400">
              <p>
                To ensure only authorized requests reach your agent, the Synapse Gateway 
                generates an <strong>HMAC-SHA256</strong> signature for every payload using your Node&apos;s Secret Key.
              </p>
              <ul className="space-y-3">
                <li className="flex gap-3">
                  <span className="text-green-400 mt-0.5">1.</span>
                  <span>Platform computes hash of the exact JSON payload using your Secret Key.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-green-400 mt-0.5">2.</span>
                  <span>Hash is sent in the <code className="text-green-300 bg-green-900/20 px-1 py-0.5 rounded">x-synapse-signature</code> header.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-green-400 mt-0.5">3.</span>
                  <span>Your server re-computes the hash using the same secret. If they match, the payload is authentic.</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-mono text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Health Check Endpoint
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Our router continuously polls your agent to ensure it is online. You must expose a lightweight health endpoint.
            </p>
            <div className="bg-black/60 p-3 rounded-lg border border-gray-800 font-mono text-xs">
              <div className="text-emerald-400 mb-1">GET /health</div>
              <div className="text-gray-500">{/* Expected Response: */}</div>
              <div className="text-gray-300">{"{"}</div>
                <div className="text-gray-300">  &quot;status&quot;: &quot;healthy&quot;</div>
              <div className="text-gray-300">{"}"}</div>
            </div>
          </div>
        </div>

        {/* Right Col: Code Snippets */}
        <div className="lg:col-span-2">
          <div className="bg-[#0A0A0A] border border-gray-800 rounded-xl overflow-hidden backdrop-blur-sm h-full flex flex-col">
            <div className="flex border-b border-gray-800 bg-gray-900/30">
              <button 
                onClick={() => setActiveTab('node')}
                className={`flex-1 py-3 px-4 text-xs font-mono font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'node' ? 'text-green-400 border-b-2 border-green-400 bg-green-500/5' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <FileCode2 className="w-4 h-4" /> Node.js (Express)
              </button>
              <button 
                onClick={() => setActiveTab('python')}
                className={`flex-1 py-3 px-4 text-xs font-mono font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'python' ? 'text-yellow-400 border-b-2 border-yellow-400 bg-yellow-500/5' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <FileCode2 className="w-4 h-4" /> Python (FastAPI)
              </button>
              <button 
                onClick={() => setActiveTab('java')}
                className={`flex-1 py-3 px-4 text-xs font-mono font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'java' ? 'text-red-400 border-b-2 border-red-400 bg-red-500/5' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <FileCode2 className="w-4 h-4" /> Java (Spring)
              </button>
            </div>
            
            <div className="p-6 overflow-x-auto flex-1">
              <pre className="font-mono text-xs text-gray-300 leading-relaxed">
{activeTab === 'node' && `const crypto = require('crypto');
const express = require('express');
const app = express();

const SECRET_KEY = process.env.A2APAY_HMAC_SECRET;

app.post('/api/agent', express.json(), (req, res) => {
  const signature = req.headers['x-synapse-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Signature valid, process message...
  res.json({ reply: 'Hello from secure agent' });
});

// Health check endpoint required by Synapse Gateway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.listen(8080);`}

{activeTab === 'python' && `import hmac
import hashlib
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET_KEY = b"your_secret_key"

@app.post("/api/agent")
async def agent_endpoint(request: Request):
    signature = request.headers.get("x-synapse-signature")
    body = await request.body()
    
    # Verify HMAC SHA-256
    expected_mac = hmac.new(SECRET_KEY, body, hashlib.sha256).hexdigest()
    
    if not hmac.compare_digest(expected_mac, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
        
    # Process valid request
    return {"reply": "Secure response"}

# Health check endpoint required by Gateway
@app.get("/health")
def health_check():
    return {"status": "healthy"}
`}

{activeTab === 'java' && String.raw`import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;

@RestController
public class AgentController {
    private final String SECRET_KEY = System.getenv("A2APAY_HMAC_SECRET");

    @PostMapping("/api/agent")
    public ResponseEntity<?> handleRequest(
            @RequestHeader("x-synapse-signature") String signature, 
            @RequestBody String body) throws Exception {
            
        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec secret_key = new SecretKeySpec(
            SECRET_KEY.getBytes(), "HmacSHA256"
        );
        sha256_HMAC.init(secret_key);
        
        byte[] bytes = sha256_HMAC.doFinal(body.getBytes());
        StringBuilder hash = new StringBuilder();
        for (byte b : bytes) {
            hash.append(String.format("%02x", b));
        }
        
        if (!hash.toString().equals(signature)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                               .body("Invalid signature");
        }
        
        return ResponseEntity.ok("{\\"reply\\":\\"Secure response\\"}");
    }
    
    @GetMapping("/health")
    public ResponseEntity<?> healthCheck() {
        return ResponseEntity.ok("{\\"status\\":\\"healthy\\"}");
    }
}
`}
              </pre>
            </div>
          </div>
        </div>

      </div>
    </div>
    </>
  );
}