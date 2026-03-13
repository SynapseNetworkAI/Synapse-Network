"use client";

import { useState, useEffect } from "react";
import { Key, ShieldCheck, Activity, Copy, CheckCircle2, FileCode2, Plus, Trash2 } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";

import { listApiSecrets, createApiSecret, deleteApiSecret, ProviderSecret } from "@/utils/serviceApi";

export default function SecretsPage() {
  const { address } = useAccount();
  const [secrets, setSecrets] = useState<ProviderSecret[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"python" | "node" | "java">("node");
  const [loading, setLoading] = useState(false);
  const [newSecretName, setNewSecretName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  
  useEffect(() => {
    async function init() {
      if (!address) return;
      try {
        setLoading(true);
        const data = await listApiSecrets(address as string);
        setSecrets(data || []);
      } catch {
        toast.error("Failed to load secrets");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [address]);

  const handleCreateSecret = async () => {
    if (!address) return;
    if (!newSecretName.trim()) {
      toast.error("Please enter a key name");
      return;
    }
    try {
      setIsCreating(true);
      const newSecret = await createApiSecret(newSecretName, address as string);
      setSecrets([newSecret, ...secrets]);
      toast.success("Secret created successfully");
      setNewSecretName("");
    } catch {
      toast.error("Failed to create secret");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSecret = async (id: string) => {
    if (!address) return;
    if (!confirm("Are you sure you want to delete this secret key? Any services using it will be blocked.")) return;
    try {
      await deleteApiSecret(id, address as string);
      setSecrets(secrets.filter(s => s.id !== id));
      toast.success("Secret deleted");
    } catch {
      toast.error("Failed to delete secret");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("API Key copied");
    setTimeout(() => setCopied(null), 2000);
  };

  return (
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
            <input 
              type="text" 
              placeholder="e.g. Production Node" 
              value={newSecretName}
              onChange={(e) => setNewSecretName(e.target.value)}
              className="bg-black border border-gray-700 px-3 py-2 rounded-md text-sm text-white focus:border-green-500 focus:outline-none"
            />
            <button 
              onClick={handleCreateSecret}
              disabled={isCreating}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-black font-semibold rounded-md text-sm transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {isCreating ? "Generating..." : "Generate Key"}
            </button>
          </div>
        </div>
        <div className="p-6">
          {!address ? (
            <div className="text-center py-8 text-gray-500 font-mono">
              Please connect your wallet to manage API Secrets.
            </div>
          ) : loading ? (
            <div className="text-center py-8 text-gray-500 font-mono animate-pulse">
              Loading secrets...
            </div>
          ) : secrets.length === 0 ? (
            <div className="text-center py-8 text-gray-500 font-mono">
              No secrets generated yet. Create one to secure your endpoints.
            </div>
          ) : (
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
                          onClick={() => copyToClipboard(sec.secretKey!, sec.id)}
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
          )}
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
              <div className="text-gray-300">  "status": "healthy"</div>
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

{activeTab === 'java' && `import javax.crypto.Mac;
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
  );
}