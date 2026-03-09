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
            Dashboard
          </Link>
          <Link href="/dashboard/agents" className="text-gray-300 hover:text-white">
            Agents
          </Link>
          <Link href="/dashboard/credentials" className="text-gray-300 hover:text-white">
            Credentials
          </Link>
          <Link href="/dashboard/services" className="text-gray-300 hover:text-white">
            Server Management
          </Link>
          <Link href="/dashboard/router" className="text-gray-300 hover:text-white">
            Auto Top-up
          </Link>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        <ConnectButton />
      </div>
    </nav>
  );
}
