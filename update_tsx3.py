import re
import os

filepath = "/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/services/deploy/page.tsx"
with open(filepath, "r") as f:
    text = f.read()

start = text.find("{/* AI Auto-Gen Modal */}")
end = text.find("LIVE_COMPILER_VIEW")
end = text.rfind("<div className=\"flex items-center text-xs text-green-500 font-mono\">", 0, end)

new_modal = """{/* AI Auto-Gen Modal */}
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

      """
if start != -1 and end != -1:
    text = text[:start] + new_modal + text[end:]
    with open(filepath, "w") as f:
        f.write(text)
    print("Replaced UI")
else:
    print("Not found", start, end)

