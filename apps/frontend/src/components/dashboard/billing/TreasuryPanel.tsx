import { Wallet, Coins, RefreshCw } from "lucide-react";

export default function TreasuryPanel({
  vaultBalance,
  walletBalance,
  onRefresh,
}: {
  vaultBalance: string;
  walletBalance: string;
  onRefresh: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {/* Vault Balance Card */}
      <div className="relative p-6 overflow-hidden border border-green-500/30 rounded-xl bg-gradient-to-br from-black/80 to-gray-900/50">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Wallet className="w-24 h-24 text-green-400" />
        </div>
        <div className="relative z-10 flex items-start justify-between">
          <div>
             <h3 className="text-sm font-medium tracking-wider text-green-400 uppercase">
                Synapse Vault Balance
             </h3>
             <p className="mt-1 text-xs text-gray-400">
                可用于 API 消费或提现的真实核心资产
             </p>
          </div>
          <button onClick={onRefresh} className="p-1.5 transition-colors bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-700 hover:text-green-400">
            <RefreshCw className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="relative z-10 flex items-baseline mt-6 space-x-2">
           <span className="text-4xl font-black tracking-tight text-white font-mono shadow-green-500 drop-shadow-md">
             {vaultBalance}
           </span>
           <span className="text-lg font-bold text-green-500">USDC</span>
        </div>
      </div>

       {/* Connected Wallet Balance Card */}
      <div className="relative p-6 overflow-hidden border border-gray-800 rounded-xl bg-black/40">
        <div className="absolute top-0 right-0 p-4 opacity-5">
          <Coins className="w-24 h-24 text-white" />
        </div>
        <div className="relative z-10">
           <h3 className="text-sm font-medium tracking-wider text-gray-400 uppercase">
              Connected Wallet Balance
           </h3>
           <p className="mt-1 text-xs text-gray-500">
              当前链上钱包内的可用 USDC
           </p>
        </div>
        <div className="relative z-10 flex items-baseline mt-6 space-x-2">
           <span className="text-3xl font-black tracking-tight text-gray-300 font-mono">
             {walletBalance}
           </span>
           <span className="text-base font-bold text-gray-500">USDC</span>
        </div>
      </div>
    </div>
  );
}
