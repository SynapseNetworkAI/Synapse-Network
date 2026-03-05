import Link from 'next/link';

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
          <Link href="/admin" className="text-gray-300 hover:text-white">
            Admin/God View
          </Link>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
        <span className="text-sm text-green-400">Mainnet Proxy Connected</span>
      </div>
    </nav>
  );
}