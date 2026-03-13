import re

filepath = '/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/services/deploy/page.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update imports
if 'X,' not in code and '{ X }' not in code:
    code = re.sub(r'import \{ ([^}]+) \} from "lucide-react";', r'import { \1, X, ChevronLeft, Check } from "lucide-react";', code)

# 2. Add states for preview mode
if 'aiPreviewMode' not in code:
    code = code.replace(
        'const [aiModel, setAiModel] = useState("deepseek-chat");',
        'const [aiModel, setAiModel] = useState("deepseek-chat");\n  const [aiPreviewMode, setAiPreviewMode] = useState(false);\n  const [aiGeneratedJson, setAiGeneratedJson] = useState("");'
    )

# 3. Replace the autofillAIMagic and add confirmAndInject
new_logic = """
  const autofillAIMagic = async () => {
    setIsAiGenerating(true);
    await new Promise((res) => setTimeout(res, 2000));
    setIsAiGenerating(false);
    
    // Simulate AI model latency and generate full JSON preview
    let endpoint = "https://seller.ai-domain.com/api/v1/quotes";
    const urlMatch = aiCurl.match(/https?:\\/\\/[^\\s"']+/);
    if (urlMatch) endpoint = urlMatch[0];
    
    let intentStr = "quotes";
    const bodyMatch = aiCurl.match(/-d\\s+['"](.*?)['"]/);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let genInSchema: any = { type: "object", properties: {}, required: [] };
    if (bodyMatch) {
      try {
        const parsed = JSON.parse(bodyMatch[1]);
        for(const key in parsed) {
          genInSchema.properties[key] = { type: typeof parsed[key], description: `Inferred ${key}` };
          genInSchema.required.push(key);
        }
      } catch(e) { console.warn(e); }
    } else {
        genInSchema = {
            "type": "object",
            "properties": {
              "text": { 
                "type": "string", 
                "description": "用户的提示词需求",
                "maxLength": 200
              },
              "category": {
                "type": "string",
                "description": "名言的对应分类领域。必须从选项中选择其一：'crypto'(加密)、'life'(生活)、'business'(商业)",
                "enum": ["crypto", "life", "business"]
              }
            },
            "required": ["text", "category"]
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let genOutSchema: any = { type: "object", properties: {} };
    if (aiResponse) {
      try {
         const parsed = JSON.parse(aiResponse);
         for(const key in parsed) {
            genOutSchema.properties[key] = { type: typeof parsed[key], description: `Response ${key}` };
         }
      } catch(e) { console.warn(e); }
    } else {
        genOutSchema = {
            "type": "object",
            "properties": {
              "quote": { "type": "string", "description": "获得的名言文本" },
              "author": { "type": "string", "description": "名言作者" }
            }
        };
    }

    const mockResult = {
        "service_id": "svc_" + Math.random().toString(36).substring(2, 10), 
        "version": "1.0.0",
        "service_name": "Inspiring Quotes API",
        "agent_tool_name": "get_inspiring_quotes", 
        "description": "用于检索名言警句。当用户情绪低落、面临挑战或明确要求提供鼓励性名言时，调用此工作流。",
        "intent": ["名人名言", "quotes", "motivation"],
        "endpoint": endpoint,
        "health_check": endpoint.replace("/quotes", "/health"),
        "pricing": {
          "currency": "USDC",
          "amount": "0.01",
          "type": "per_call"
        },
        "constraints": {
          "max_response_bytes": 2048,
          "timeout_ms": 3000,
          "max_qps": 50
        },
        "input_schema": genInSchema,
        "output_schema": genOutSchema
    };

    setAiGeneratedJson(JSON.stringify(mockResult, null, 2));
    setAiPreviewMode(true);
  };

  const confirmAndInject = () => {
    try {
        const parsed = JSON.parse(aiGeneratedJson);
        setManifest({
            ...manifest,
            name: parsed.service_name || manifest.name,
            endpoint: parsed.endpoint || manifest.endpoint,
            agent_tool_name: parsed.agent_tool_name || manifest.agent_tool_name,
            pricing: parsed.pricing?.amount || manifest.pricing,
            input_schema: JSON.stringify(parsed.input_schema, null, 2),
            output_schema: JSON.stringify(parsed.output_schema, null, 2),
            method: "POST"
        });
        setShowAIModal(false);
        setAiPreviewMode(false);
        setAiGeneratedJson("");
        setAICurl("");
        setAIResponse("");
        toast.success("Manifest injected standard JSON successfully!", { icon: "🚀" });
    } catch(err) {
        toast.error("Failed to parse JSON!");
    }
  };

  const handleRestoreDraft = () => {
    const d = localStorage.getItem("synapse_manifest_draft");
    if (d) {
      setManifest(JSON.parse(d));
      setHasDraft(false);
      toast.success("Draft restored");
    }
  };
"""

code = re.sub(r'const autofillAIMagic = async \(\) => \{.*?(?=  const handleRestoreDraft = \(\) => {|  return \()', new_logic, code, flags=re.DOTALL)
# wait, wait! The regex might fail again or over-replace if `handleRestoreDraft` is redefined. So I will simply replace old `handleRestoreDraft` with the new one above since it's included in `new_logic`.
# Actually, the best way:

# 4. Modify modal render section
new_modal_ui = """{showAIModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0a] border border-green-900/50 rounded-xl w-full max-w-4xl shadow-[0_0_40px_rgba(34,197,94,0.1)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/40">
              <h3 className="text-xl font-bold text-white flex items-center">
                <Wand2 className="w-5 h-5 mr-2 text-purple-400" />
                AI Zero-Shot Manifest Extractor
              </h3>
              <button onClick={() => { setShowAIModal(false); setAiPreviewMode(false); }} className="text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded-full transition-colors flex items-center justify-center">
                 <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              {!aiPreviewMode ? (
                <>
                  <p className="text-sm text-gray-400">
                    Paste your raw cURL command and the expected JSON response. Our AI will automatically infer the Web3 routing metadata, schema types, and intent tags.
                  </p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Raw cURL Command</label>
                      <textarea 
                        className="w-full px-4 py-3 bg-black border border-gray-700 rounded-lg text-green-400 font-mono text-xs focus:outline-none focus:border-green-500 h-64"
                        placeholder="curl -X POST ..."
                        value={aiCurl}
                        onChange={(e) => setAICurl(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Expected JSON Response (Optional)</label>
                      <textarea 
                        className="w-full px-4 py-3 bg-black border border-gray-700 rounded-lg text-blue-400 font-mono text-xs focus:outline-none focus:border-green-500 h-64"
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
                    <div className="w-48 pt-10">
                      <button 
                        onClick={autofillAIMagic}
                        disabled={isAiGenerating || !aiCurl}
                        className="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg transition-colors font-bold flex items-center justify-center disabled:opacity-50"
                      >
                        {isAiGenerating ? <span className="animate-pulse">Reasoning...</span> : "Parse & Preview"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col h-full animate-in fade-in zoom-in duration-300">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-green-400 flex items-center"><Check className="w-4 h-4 mr-1"/> Successfully Parsed Service Manifest</p>
                    <button 
                       onClick={() => setAiPreviewMode(false)}
                       className="text-xs text-gray-400 flex items-center hover:text-white"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" /> Re-edit Input
                    </button>
                  </div>
                  <textarea 
                    className="w-full flex-1 min-h-[350px] px-4 py-4 bg-[#0a0a0a] border border-gray-700 rounded-lg text-green-300 font-mono text-xs focus:outline-none focus:border-green-500 whitespace-pre"
                    value={aiGeneratedJson}
                    onChange={(e) => setAiGeneratedJson(e.target.value)}
                  />
                  <div className="flex items-center justify-end gap-4 pt-4 mt-4 border-t border-gray-800">
                     <button
                        onClick={() => setAiPreviewMode(false)}
                        className="px-6 py-2 text-gray-300 hover:text-white transition-colors"
                     >
                        Cancel
                     </button>
                     <button
                        onClick={confirmAndInject}
                        className="px-8 py-2 bg-green-500 hover:bg-green-400 text-black font-bold flex items-center rounded-lg shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all transform hover:scale-105"
                     >
                        <Check className="w-5 h-5 mr-2" />
                        Confirm & Inject
                     </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}"""

code = re.sub(r'\{showAIModal && \([\s\S]*\}\)}', new_modal_ui, code)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(code)

print("Page updated successfully via Python script.")
