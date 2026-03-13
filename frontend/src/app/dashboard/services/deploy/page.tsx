"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Copy, Wand2, TerminalSquare, Server, X, Check } from "lucide-react";
import toast from "react-hot-toast";

// Extracted from api_gateway_reverse_proxy_design.md
interface ServiceManifest {
  service_name: string;
  agent_tool_name: string;
  description: string;
  intent: string[];
  endpoint: string;
  health_check: string;
  pricing: {
    currency: string;
    amount: string;
    type: string;
  };
  constraints: {
    max_response_bytes: number;
    timeout_ms: number;
    max_qps: number;
  };
  input_schema: object;
  output_schema: object;
}

export default function DeployManifestPage() {
  const [manifest, setManifest] = useState<ServiceManifest>({
    service_name: "",
    agent_tool_name: "",
    description: "",
    intent: [],
    endpoint: "",
    health_check: "",
    pricing: {
      currency: "USDC",
      amount: "0.01",
      type: "per_call",
    },
    constraints: {
      max_response_bytes: 2048,
      timeout_ms: 3000,
      max_qps: 50,
    },
    input_schema: {},
    output_schema: {},
  });

  const [intentInput, setIntentInput] = useState("");
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiCurl, setAICurl] = useState("");
  const [aiResponse, setAIResponse] = useState("");
  const [aiModel, setAiModel] = useState("deepseek-chat");
      const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const draft = localStorage.getItem("synapse_manifest_draft");
    if (draft) {
      setHasDraft(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("synapse_manifest_draft", JSON.stringify(manifest));
  }, [manifest]);

  const handleRestoreDraft = () => {
    const draft = localStorage.getItem("synapse_manifest_draft");
    if (draft) {
      try {
        setManifest(JSON.parse(draft));
        toast.success("Unsaved progress restored!", { icon: "📦" });
        setHasDraft(false);
      } catch (e) {
        console.error("Draft parsing failed", e);
      }
    }
  };

  const handleUpdate = (field: string, value: unknown) => {
    setManifest((prev) => {
      const keys = field.split(".");
      if (keys.length === 1) {
        return { ...prev, [field]: value };
      }
      return {
        ...prev,
        [keys[0]]: {
          ...(prev[keys[0] as keyof ServiceManifest] as object),
          [keys[1]]: value,
        },
      };
    });
  };

  const handleAddIntent = () => {
    if (intentInput.trim() && !manifest.intent.includes(intentInput.trim())) {
      handleUpdate("intent", [...manifest.intent, intentInput.trim()]);
      setIntentInput("");
    }
  };

  const handleRemoveIntent = (tag: string) => {
    handleUpdate(
      "intent",
      manifest.intent.filter((t) => t !== tag)
    );
  };

  const confirmAndInject = () => {
    try {
      const parsed = JSON.parse(aiResponse);
      const isMissingRequired = !parsed.service_name || !parsed.agent_tool_name || !parsed.endpoint;
      if (isMissingRequired) {
         toast.error("Please fill in missing required fields.");
      }
      setManifest((prev) => ({
        ...prev,
        ...parsed,
        input_schema: parsed.input_schema || prev.input_schema,
        output_schema: parsed.output_schema || prev.output_schema,
        pricing: parsed.pricing || prev.pricing,
        constraints: parsed.constraints || prev.constraints,
      }));
      setShowAIModal(false);
      toast.success("Manifest injected from AI!");
    } catch {
      toast.error("Valid JSON is required in the right panel!");
    }
  };

  const autofillAIMagic = async () => {
    setIsAiGenerating(true);
    
    // Simulate AI model latency
    await new Promise((res) => setTimeout(res, 2000));
    
    setIsAiGenerating(false);
    
    // Simple naive parser to make it look "real" for the presentation
    let endpoint = manifest.endpoint || "";
    
    const urlMatch = aiCurl.match(/https?:\/\/[^\s"']+/);
    if (urlMatch) endpoint = urlMatch[0];
    
    const generatedInputSchema: { type: string; properties: Record<string, unknown>; required: string[] } = {
      type: "object",
      properties: {},
      required: []
    };
    
    // Naively extract from curl -d
    const bodyMatch = aiCurl.match(/-d\s+['"](.*?)['"]/);
    if (bodyMatch) {
      try {
        const parsed = JSON.parse(bodyMatch[1]);
        for(const key in parsed) {
          generatedInputSchema.properties[key] = { type: typeof parsed[key], description: `Inferred ${key}` };
          generatedInputSchema.required.push(key);
        }
      } catch(e) { console.warn(e); }
    }

    const generatedOutputSchema: { type: string; properties: Record<string, unknown> } = {
       type: "object",
       properties: {}
    };
    
    if (aiResponse) {
      try {
        const respParsed = JSON.parse(aiResponse);
        for(const key in respParsed) {
          if (Array.isArray(respParsed[key])) {
             const itemType = respParsed[key].length > 0 ? typeof respParsed[key][0] : "string";
             generatedOutputSchema.properties[key] = { type: "array", items: { type: itemType } };
          } else {
             generatedOutputSchema.properties[key] = { type: typeof respParsed[key] };
          }
        }
      } catch(e) { console.warn(e); }
    }
    
    const newManifestSubset = {
      service_name: manifest.service_name || (urlMatch ? "DeepSeek Famous Quotes API" : "Extracted Web Service"),
      agent_tool_name: manifest.agent_tool_name || "get_famous_quotes",
      description: manifest.description || `Auto-generated from ${aiModel} based on provided curl.`,
      endpoint: endpoint,
      input_schema: Object.keys(generatedInputSchema.properties).length > 0 ? generatedInputSchema : manifest.input_schema,
      output_schema: Object.keys(generatedOutputSchema.properties).length > 0 ? generatedOutputSchema : manifest.output_schema,
      intent: manifest.intent.length > 0 ? manifest.intent : ["quotes", "deepseek", "famous"],
    };
    
    setAIResponse(JSON.stringify(newManifestSubset, null, 2));
    toast.success("AI schema generated! Review the right panel before confirming.", { icon: "🪄" });
  };

  const submitDeploy = async () => {
    setIsDeploying(true);
    localStorage.removeItem("synapse_manifest_draft"); // clear draft on deploy
    // Simulate network delay
    await new Promise((res) => setTimeout(res, 1500));
    setIsDeploying(false);

    // Mock successful deployment & return of the HMAC key
    setSecretKey("sk_live_synapse_9f8e7d6c5b4a3f2e1d0c");
    toast.success("Manifest successfully injected into Synapse Network!");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (secretKey) {
    return (
      <div className="max-w-3xl p-8 mx-auto mt-10 border border-green-500 shadow-2xl rounded-2xl bg-gray-900/80 shadow-green-500/20 backdrop-blur-md animate-in fade-in zoom-in">
        <div className="flex flex-col items-center text-center">
          <div className="p-4 mb-6 rounded-full bg-green-500/20">
            <CheckCircle2 className="w-16 h-16 text-green-400" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">Service Deployed Successfully!</h2>
          <p className="text-gray-400 mb-8 max-w-lg">
            Your API is now live on Synapse Network. Buyers can automatically discover and call your service using the <span className="font-mono text-green-400">&quot;{manifest.agent_tool_name}&quot;</span> tool.
          </p>

          <div className="w-full p-6 text-left border border-gray-700 bg-black/60 rounded-xl mb-8">
            <h3 className="text-lg font-bold text-white flex items-center mb-4">
              <SecurityIcon className="w-5 h-5 mr-2 text-yellow-500" />
              Gateway HMAC Secret Key
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              IMPORTANT: This key guards your server against unauthorized &quot;freeloader&quot; traffic. Set this in your Python SDK environment variables. We will NOT show it again.
            </p>
            <div className="flex items-center justify-between p-3 font-mono text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
              <span>{secretKey}</span>
              <button onClick={() => copyToClipboard(secretKey)} className="p-2 hover:bg-yellow-500/20 rounded-md transition-colors">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          <Link href="/dashboard/services" className="px-8 py-3 font-bold text-black border border-green-500 bg-green-500 rounded-lg hover:bg-green-400 transition-colors w-full sm:w-auto">
            Return to Service Management
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col md:flex-row bg-[#050505] overflow-hidden">
      {/* LEFT SIDE: BUILDER FORM */}
      <div className="w-full md:w-1/2 h-full overflow-y-auto border-r border-gray-800 p-8 hide-scrollbar">
        <div className="mb-8">
          <Link href="/dashboard/services" className="inline-flex items-center text-gray-400 hover:text-green-400 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center">
                <Server className="w-6 h-6 mr-3 text-green-500" />
                Build Service Manifest
              </h1>
              <p className="text-gray-500 mt-2 text-sm">Design your AI-native API contract. Synapse Gateway will use this to route buyer requests and process zero-gas payments.</p>
            </div>
            {hasDraft && (
              <button 
                onClick={handleRestoreDraft}
                className="text-xs px-3 py-1.5 bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 rounded-lg hover:bg-yellow-500/30 transition shadow-sm whitespace-nowrap ml-4 flex-shrink-0"
              >
                导入未完成草稿
              </button>
            )}
          </div>
        </div>

        <div className="space-y-8">
          {/* Section 1: AI Interface */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-gray-800 pb-2">1. Artificial Intelligence Interface</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Service Name (Human Readable)</label>
              <input 
                type="text" 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-green-500"
                placeholder="e.g. DeepSeek Market Analysis"
                value={manifest.service_name}
                onChange={(e) => handleUpdate("service_name", e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Agent Tool Name <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                placeholder="e.g. get_market_analysis"
                value={manifest.agent_tool_name}
                onChange={(e) => handleUpdate("agent_tool_name", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              />
              <p className="text-xs text-gray-600 mt-1">Must match regex ^[a-zA-Z0-9_-]+$ for OpenAI Tool capability.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Description (Trigger Condition)</label>
              <textarea 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 h-24"
                placeholder="Give autonomous agents clear instructions on WHEN and WHY they should invoke this tool..."
                value={manifest.description}
                onChange={(e) => handleUpdate("description", e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Semantic Intents (Tags)</label>
              <div className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                  placeholder="e.g. crypto, weather, indexing"
                  value={intentInput}
                  onChange={(e) => setIntentInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddIntent()}
                />
                <button onClick={handleAddIntent} className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {manifest.intent.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-green-900/30 border border-green-500/30 text-green-400 text-xs rounded-full flex items-center">
                    {tag}
                    <button onClick={() => handleRemoveIntent(tag)} className="ml-2 text-green-600 hover:text-green-300">&times;</button>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Section 2: Economics and Routing */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-gray-800 pb-2">2. Routing & SLA Economics</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Physical Provider Endpoint</label>
              <input 
                type="text" 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                placeholder="https://your-server.com/api/v1/invoke"
                value={manifest.endpoint}
                onChange={(e) => handleUpdate("endpoint", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Price / Call (USDC)</label>
                <input 
                  type="number" 
                  step="0.001"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-green-400 font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.pricing.amount}
                  onChange={(e) => handleUpdate("pricing.amount", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Max QPS Rate Limit</label>
                <input 
                  type="number" 
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.constraints.max_qps}
                  onChange={(e) => handleUpdate("constraints.max_qps", parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </section>

          {/* Section 3: AI Schema Magic */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h2 className="text-lg font-bold text-white">3. Data Schema</h2>
              <button 
                onClick={() => setShowAIModal(true)}
                className="text-xs flex items-center px-4 py-1.5 bg-purple-500/20 text-purple-300 border border-purple-500/50 rounded-lg hover:bg-purple-500/30 transition shadow-[0_0_15px_rgba(168,85,247,0.3)] font-bold tracking-wide"
              >
                <Wand2 className="w-4 h-4 mr-2" />
                🪄 AI Auto-Gen: 从 cURL 导入
              </button>
            </div>
            
            <p className="text-xs text-gray-500">Define the JSON Schema that agents will use to parse arguments and responses. Generating via AI is recommended.</p>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Input Schema (JSON)</label>
              <textarea 
                className="w-full px-4 py-2 bg-black border border-gray-800 rounded-lg text-gray-300 font-mono text-xs focus:outline-none focus:border-gray-600 h-32"
                value={JSON.stringify(manifest.input_schema, null, 2)}
                onChange={(e) => {
                  try { handleUpdate("input_schema", JSON.parse(e.target.value)); } catch { /* ignore parse error while typing */ }
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 mt-4">Output Schema (JSON)</label>
              <textarea 
                className="w-full px-4 py-2 bg-black border border-gray-800 rounded-lg text-gray-300 font-mono text-xs focus:outline-none focus:border-gray-600 h-32"
                value={JSON.stringify(manifest.output_schema, null, 2)}
                onChange={(e) => {
                  try { handleUpdate("output_schema", JSON.parse(e.target.value)); } catch { /* ignore parse error while typing */ }
                }}
              />
            </div>
          </section>
          
          <div className="pt-6 border-t border-gray-800">
            <button
              onClick={submitDeploy}
              disabled={isDeploying || !manifest.agent_tool_name || !manifest.endpoint}
              className="w-full py-3 font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
            >
              {isDeploying ? "DEPLOYING..." : "CONFIRM & DEPLOY"}
            </button>
          </div>

        </div>
      </div>

      {/* RIGHT SIDE: TERMINAL PREVIEW */}
      <div className="w-full md:w-1/2 h-full bg-[#0a0a0a] flex flex-col relative">
        <div className="p-3 border-b border-green-900/30 bg-black flex justify-between items-center">
          {/* AI Auto-Gen Modal */}
      {showAIModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0a] border border-green-900/50 rounded-xl w-full max-w-5xl shadow-[0_0_40px_rgba(34,197,94,0.1)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/40">
              <h3 className="text-xl font-bold text-white flex items-center">
                <Wand2 className="w-5 h-5 mr-2 text-purple-400" />
                AI Ze                AI Zractor
              </h3>
              <button onClick={() => setShowAIModal(false)} className="text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded-lg transition-colors flex items-center justify-center">
                 <X className="w-8 h-8" />
              </button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto w-full">
              <p className="text-sm text-gray-400 mb-2">
                Paste your raw cURL command. Parse will auto-infer schemas/routing. Confirm to inject.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Raw cURL Command</label>
                  <textarea 
                    className="w-full px-4 py-3 bg-black border border-gray-700 rounded-lg text-green-400 font-mono text-xs focus:outline-none focus:border-green-500 h-[400px]"
                    placeholder="curl -X POST ..."
                    value={aiCurl}
                    onChange={(e) => setAICurl(e.target.value)}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-300 mb-1 flex justify-between">
                     <span>Expected / Generated JSON Response</span>
                  </label>
                  <textarea 
                    className="w-full flex-1 px-4 py-3 bg-[#050505] border border-gray-700 rounded-lg text-blue-400 font-mono text-xs focus:outline-none focus:border-green-500 h-[400px]"
                    placeholder='{"status": "success"}'
                    value={aiResponse}
                    onChange={(e) => setAIResponse(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 pt-2 border-t border-gray-800 mt-4">
                <div className="flex-1 mt-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">AI Reasoning Model</label>
                  <select 
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                  >
                    <option value="deepseek-chat">DeepSeek R1 (Recommended)</option>
                    <option value="deepseek-coder">DeepSeek Coder</option>
                    <option value="gpt-4-turbo">OpenAI GPT-4 Turbo</option>
                  </select>
                </div>
                <div className="flex justify-end gap-3 pt-10">
                  <button 
                    onClick={autofillAIMagic}
                    disabled={isAiGenerating || !aiCurl}
                    className="px-8 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors font-bold flex items-center justify-center disabled:opacity-50 min-w-[120px]"
                  >
                    {isAiGenerating ? <span className="animate-pulse">Parsing...</span> : "Parse"}
                  </button>
                  <button 
                    onClick={confirmAndInject}
                    disabled={!aiResponse || isAiGenerating}
                    className="px-8 py-2 bg-green-500 hover:bg-green-400 text-black rounded-lg transition-colors font-bold flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.3)] min-w-[120px] disabled:opacity-50 disabled:shadow-none"
                  >
                    <Check className="w-5 h-5 mr-1" />
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center text-xs text-green-500 font-mono">
            <TerminalSquare className="w-4 h-4 mr-2" />
            LIVE_COMPILER_VIEW
          </div>
          <div className="flex space-x-2">
            <div className="w-3 h-3 rounded-full bg-red-600"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-600"></div>
            <div className="w-3 h-3 rounded-full bg-green-600"></div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed hide-scrollbar relative">
          {/* Abstract Cyberpunk Grid Background */}
          <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(rgba(34,197,94,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.3)_1px,transparent_1px)] bg-[size:20px_20px]" />
          
          <pre className="text-green-400 whitespace-pre-wrap">
            <span className="text-gray-500">{"// SYNAPSE NETWORK: MANIFEST PREVIEW"}</span>
            <br />
            <span className="text-gray-500">{"// Status: Ready to Deploy"}</span>
            <br /><br />
            {JSON.stringify(manifest, null, 2).replace(/"(.*?)":/g, '<span style="color: #60a5fa">"$1"</span>:')}
          </pre>
        </div>

        <div className="p-6 bg-black border-t border-green-900/30 mt-auto shadow-[0_-20px_40px_rgba(0,0,0,0.5)] z-10">
          <button
            onClick={submitDeploy}
            disabled={isDeploying || !manifest.agent_tool_name || !manifest.endpoint}
            className="w-full py-4 font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {isDeploying ? (
              <span className="animate-pulse">INJECTING TO MAINNET...</span>
            ) : (
              <span>DEPLOY MANIFEST</span>
            )}
          </button>
          <p className="text-center text-[10px] text-gray-600 mt-3 font-mono">
            By deploying, you accept the Seller Gateway ToS. Cost: 0 Gas (Off-chain injection).
          </p>
        </div>
      </div>
    </div>
  );
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function SecurityIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
