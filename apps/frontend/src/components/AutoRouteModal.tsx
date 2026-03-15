import { Bot, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

interface AutoRouteModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  targetRole: "CONSUMER" | "PROVIDER";
}

export default function AutoRouteModal({ isOpen, onConfirm, targetRole }: AutoRouteModalProps) {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      setCountdown(3);
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            onConfirm();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isOpen, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md p-6 border border-green-500/50 rounded-xl bg-gray-900 shadow-[0_0_40px_rgba(34,197,94,0.15)] text-center animate-in zoom-in duration-300">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-green-900/30 rounded-full border border-green-500/30">
            <Bot className="w-10 h-10 text-green-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Welcome Back!</h2>
        <div className="p-3 mb-6 bg-green-900/10 border border-green-700/50 rounded-lg">
          <p className="text-gray-300 text-sm leading-relaxed">
            系统检测到此钱包已注册为 <strong className="text-green-400">{targetRole === "CONSUMER" ? "买家 (Consumer)" : "卖家 (Provider)"}</strong> 身份。
            <br/>
            正在为您自动漫游至专属控制台...
          </p>
        </div>
        
        <div className="flex items-center justify-center space-x-2 text-green-500 font-mono text-sm mb-4">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>正在跃迁... {countdown}s</span>
        </div>

        <button
          onClick={onConfirm}
          className="w-full py-3 text-sm font-bold text-black border border-green-500 bg-green-500 rounded-lg hover:bg-green-400 transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
        >
          立即跃迁 (Jump Now)
        </button>
      </div>
    </div>
  );
}
