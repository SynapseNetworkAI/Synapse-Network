import sys

page_path = "frontend/src/app/dashboard/agents/[id]/page.tsx"

with open(page_path, "r") as f:
    code = f.read()

# I want to inject the real agent balance JSX and the mock financial UI row

old_header_card = """          <div className="border border-green-900/50 bg-black p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Cpu className="text-green-500 w-8 h-8 mr-3" />
                <div>
                  <h1 className="text-3xl font-black text-white leading-none">{agent.name}</h1>
                  <span className="text-sm text-green-400 font-mono tracking-wider">{agent.role}</span>
                </div>
              </div>
              <button onClick={deleteAgent} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-colors">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>"""

new_header_card = """          <div className="border border-green-900/50 bg-black p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center">
              <Cpu className="text-green-500 w-10 h-10 mr-4" />
              <div>
                <h1 className="text-3xl font-black text-white leading-none">{agent.name}</h1>
                <span className="text-sm text-green-400 font-mono tracking-wider">{agent.role}</span>
              </div>
            </div>
            <div className="flex gap-2 items-stretch">
              <div className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-right flex-1">
                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">On-Chain USDC</div>
                <div className="text-xl font-mono text-green-400 font-bold">${agentBalance}</div>
              </div>
              <button onClick={deleteAgent} className="text-red-500 hover:bg-red-500/10 p-3 border border-red-900/30 rounded-lg transition-colors flex items-center justify-center" title="Decommission Agent">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {/* Financials Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black border border-gray-800 p-5 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400 font-medium">24h Revenue</span>
                <ArrowUpRight className="text-emerald-400 w-4 h-4" />
              </div>
              <div className="text-2xl font-bold text-emerald-400">{mockAgentRevenue}</div>
            </div>
            <div className="bg-black border border-gray-800 p-5 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400 font-medium">24h Expense & Gas</span>
                <ArrowDownRight className="text-red-400 w-4 h-4" />
              </div>
              <div className="text-2xl font-bold text-red-400">{mockAgentExpense}</div>
            </div>
          </div>

          """

code = code.replace(old_header_card, new_header_card)

with open(page_path, "w") as f:
    f.write(code)
