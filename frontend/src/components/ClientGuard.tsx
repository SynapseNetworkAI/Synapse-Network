'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ClientGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    // Check local storage for session
    const session = localStorage.getItem('developer_session');
    if (session) {
      setIsAuthenticated(true);
    }
    setIsChecking(false);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate login for dev
    localStorage.setItem('developer_session', 'active');
    setIsAuthenticated(true);
    router.refresh();
  };

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="font-mono text-cyan-400 animate-pulse">Initializing Neural Link...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-repeat">
        <div className="w-full max-w-md bg-zinc-900 border border-cyan-500/30 rounded-lg shadow-[0_0_15px_rgba(34,211,238,0.2)] overflow-hidden backdrop-blur-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-zinc-800/50">
            <h2 className="flex items-center font-mono text-xl font-bold tracking-wider text-cyan-400">
              <span className="inline-block w-2 h-2 mr-2 bg-pink-500 rounded-full animate-pulse"></span>
              DEVELOPER_CONSOLE
            </h2>
            <div className="font-mono text-xs text-zinc-500">v1.0.0</div>
          </div>
          
          <div className="p-8">
            <div className="p-4 mb-6 border rounded bg-zinc-950/50 border-zinc-800">
              <p className="font-mono text-sm leading-relaxed text-center text-zinc-400">
                Access restricted. <br/>
                Please establish secure connection or initialize new developer account.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-mono text-cyan-200/70 mb-1.5 uppercase tracking-widest">Access Token / Email</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 font-mono text-sm transition-colors border rounded bg-zinc-950 border-zinc-700 text-zinc-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  placeholder="admin/admin for demo"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-mono text-cyan-200/70 mb-1.5 uppercase tracking-widest">Security Key</label>
                <input 
                  type="password" 
                  className="w-full px-4 py-2 font-mono text-sm transition-colors border rounded bg-zinc-950 border-zinc-700 text-zinc-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="pt-2">
                <button 
                  type="submit"
                  className="w-full bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 font-mono py-2.5 rounded hover:bg-cyan-500/20 hover:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all uppercase tracking-widest text-sm"
                >
                  Establish Connection
                </button>
              </div>
              
              <div className="mt-4 text-center">
                <button 
                  type="button"
                  onClick={handleLogin}
                  className="font-mono text-xs transition-colors text-pink-400/80 hover:text-pink-300"
                >
                  register_new_entity()
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
