import { AlertTriangle, ShieldAlert } from "lucide-react";

interface RoleWarningModalProps {
  isOpen: boolean;
  onDisconnect: () => void;
  targetRole: "Buyer" | "Seller";
}

export default function RoleWarningModal({ isOpen, onDisconnect, targetRole }: RoleWarningModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg p-6 border border-red-500/50 rounded-xl bg-gray-900 shadow-[0_0_40px_rgba(239,68,68,0.15)]">
        <div className="flex items-center space-x-3 text-red-500 mb-4">
          <ShieldAlert className="w-8 h-8" />
          <h2 className="text-xl font-bold">Hard Block: Mixed Wallet Detected</h2>
        </div>
        
        <div className="space-y-4 text-gray-300">
          <div className="p-4 bg-red-900/20 border border-red-700/50 rounded-lg text-sm leading-relaxed">
            <p className="flex items-start">
              <AlertTriangle className="w-5 h-5 mr-no-shrink mr-2 text-red-500 flex-shrink-0 mt-0.5" />
              <span>
                系统检测到您正试图在同一个钱包地址上混合使用 <strong>Buyer (API消费者)</strong> 和 <strong>Seller (API提供方)</strong> 职能。
              </span>
            </p>
          </div>
          
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-400">
            <li><strong>架构限制：</strong>在底层智能合约中，充值资金（Vault）和收益（Revenue）对同一地址不做区分。如果混合角色使用，页面账单与可提现金额将发生严重显示错乱。</li>
            <li><strong>安全强制：</strong>为防止账户串流，平台禁止 {targetRole} 空间被曾用于其他角色的钱包访问。</li>
          </ul>

          <p className="text-sm font-semibold text-gray-300 mt-4 text-red-400">
            强制行动：您的钱包将被断开连接。请使用干净独立的钱包重新连接。
          </p>
        </div>

        <div className="flex items-center justify-end mt-8 space-x-4">
          <button
            onClick={onDisconnect}
            className="px-5 py-2.5 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors"
          >
            Disconnect & Switch
          </button>
        </div>
      </div>
    </div>
  );
}
