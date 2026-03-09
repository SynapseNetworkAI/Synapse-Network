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
          <Link href="/dashboard/discover" className="text-gray-300 hover:text-white">
            Discover
          </Link>
          <Link href="/dashboard/buy" className="text-gray-300 hover:text-white">
            Buy
          </Link>
          <Link href="/dashboard/sell" className="text-gray-300 hover:text-white">
            Sell
          </Link>
          <Link href="/dashboard/billing" className="text-gray-300 hover:text-white">
            Billing
          </Link>
          <Link href="/dashboard/settlement" className="text-gray-300 hover:text-white">
            Settlement
          </Link>
          <Link href="/dashboard/credentials" className="text-gray-300 hover:text-white">
            Credentials
          </Link>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        <ConnectButton />
      </div>
    </nav>
  );
}
