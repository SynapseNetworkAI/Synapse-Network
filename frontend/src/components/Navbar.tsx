import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800">
      <div className="flex items-center space-x-6">
        <Link href="/" className="text-xl font-bold tracking-wider text-green-400">
          A2A-PAY
        </Link>
        <div className="space-x-4">
          <Link href="/dashboard" className="text-gray-300 hover:text-white">
            Overview
          </Link>
          <Link href="/dashboard/console" className="px-3 py-1 font-semibold text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg hover:text-green-300 hover:bg-green-500/20">
            Developer Console
          </Link>
          <Link href="/dashboard/services" className="text-gray-300 hover:text-white">
            Seller Registry
          </Link>
          <Link href="/dashboard/settlement" className="text-gray-300 hover:text-white">
            Settlement
          </Link>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        <ConnectButton />
      </div>
    </nav>
  );
}
