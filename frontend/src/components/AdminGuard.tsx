"use client";

import React, { useState, useEffect } from 'react';
import { ShieldAlert, KeyRound, Mail, Lock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { generateSecret, generateURI, verifySync } from 'otplib';

const ADMIN_EMAIL = 'niubidecc@gmail.com';
const ADMIN_PASS = '199426.Cc';

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const [step, setStep] = useState<"LOGIN" | "SETUP_2FA" | "VERIFY_2FA">("LOGIN");
  const [email, setEmail] = useState("niubidecc@gmail.com");
  const [password, setPassword] = useState("199426.Cc");
  const [totpCode, setTotpCode] = useState("");
  
  const [secret, setSecret] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const isAuthed = localStorage.getItem("admin_authenticated");
    if (isAuthed === "true") {
      setIsAuthenticated(true);
    }
    setIsInitializing(false);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
      const storedSecret = localStorage.getItem("admin_2fa_secret");
      if (storedSecret) {
        setSecret(storedSecret);
        setStep("VERIFY_2FA");
      } else {
        const newSecret = generateSecret();
        const uri = generateURI({secret: newSecret, label: ADMIN_EMAIL, issuer: 'A2A-Pay Admin'});
        setSecret(newSecret);
        setQrUrl(uri);
        setStep("SETUP_2FA");
      }
    } else {
      setError("Invalid Email or Password. Access Denied.");
    }
  };

  const handleVerify2FA = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const result = verifySync({ token: totpCode, secret });
      // In some versions verifySync returns boolean, in others an object
      const isValid = typeof result === 'boolean' ? result : !!result?.valid;
      if (isValid) {
        localStorage.setItem("admin_2fa_secret", secret);
        localStorage.setItem("admin_authenticated", "true");
        setIsAuthenticated(true);
      } else {
        setError("Invalid 2FA Code. Sequence rejected.");
      }
    } catch (err) {
      console.error(err);
      setError("Error verifying code.");
    }
  };

  if (isInitializing) return null;

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#00FFA3] font-mono flex flex-col items-center justify-center p-6 selection:bg-[#00FFA3] selection:text-black">
      <div className="w-full max-w-md border border-[#00FFA3]/30 bg-black/80 p-8 rounded relative overflow-hidden group hover:border-[#00FFA3] transition-colors shadow-[0_0_30px_rgba(0,255,163,0.1)]">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#00FFA3] opacity-10 blur-[50px]"></div>
        
        <div className="flex justify-center mb-6">
          <ShieldAlert className="w-12 h-12 text-[#00FFA3] animate-pulse shadow-[0_0_15px_#00FFA3] rounded-full" />
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-widest text-center uppercase">
          Admin Portal
        </h1>
        <p className="text-center text-xs opacity-50 mb-8 border-b border-[#00FFA3]/20 pb-4">
          RESTRICTED PROTOCOL ACCESS
        </p>

        {error && (
          <div className="p-3 mb-6 text-sm text-center text-red-400 border border-red-500 rounded bg-red-900/40 animate-pulse">
            {error}
          </div>
        )}

        {step === "LOGIN" && (
          <form onSubmit={handleLogin} className="relative z-10 space-y-4">
            <div>
              <label className="block mb-2 text-xs uppercase opacity-70">Identifier</label>
              <div className="relative">
                <Mail className="absolute w-4 h-4 opacity-50 left-3 top-3" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#00FFA3]/5 border border-[#00FFA3]/30 rounded p-2 pl-10 text-[#00FFA3] focus:outline-none focus:border-[#00FFA3] transition-colors"
                  placeholder="admin@a2a.pay"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block mb-2 text-xs uppercase opacity-70">Passphrase</label>
              <div className="relative">
                <Lock className="absolute w-4 h-4 opacity-50 left-3 top-3" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#00FFA3]/5 border border-[#00FFA3]/30 rounded p-2 pl-10 text-[#00FFA3] focus:outline-none focus:border-[#00FFA3] transition-colors"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full bg-[#00FFA3]/10 hover:bg-[#00FFA3]/20 border border-[#00FFA3]/50 p-3 font-bold tracking-widest uppercase rounded mt-4 transition-all hover:shadow-[0_0_15px_#00FFA3]"
            >
              Initialize Connection
            </button>
          </form>
        )}

        {step === "SETUP_2FA" && (
          <form onSubmit={handleVerify2FA} className="relative z-10 flex flex-col items-center space-y-6">
            <div className="mb-2 text-sm text-center">
              <span className="block mb-2 font-bold text-yellow-400">2FA Device Unbound</span>
              Scan this Matrix QR Code with Google Authenticator to bind your God-mode terminal.
            </div>
            
            <div className="p-4 bg-white rounded-lg">
              <QRCodeSVG value={qrUrl} size={180} />
            </div>

            <div className="w-full">
              <label className="block mb-2 text-xs uppercase opacity-70">Enter Verification Code</label>
              <div className="relative">
                <KeyRound className="absolute w-4 h-4 opacity-50 left-3 top-3" />
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="w-full bg-[#00FFA3]/5 border border-[#00FFA3]/30 rounded p-2 pl-10 text-[#00FFA3] focus:outline-none focus:border-[#00FFA3] text-center tracking-[0.5em] text-lg font-bold"
                  placeholder="000000"
                  maxLength={6}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 p-3 font-bold tracking-widest uppercase rounded transition-all hover:shadow-[0_0_15px_rgba(234,179,8,0.5)]"
            >
              Verify & Bind 2FA
            </button>
          </form>
        )}

        {step === "VERIFY_2FA" && (
          <form onSubmit={handleVerify2FA} className="relative z-10 space-y-6">
            <div className="mb-4 text-sm text-center">
              <span className="block mb-2 text-[#00FFA3] opacity-80">Identity confirmed. Waiting for two-factor approval.</span>
              Please enter the 6-digit TOTP code from your Google Authenticator.
            </div>

            <div className="w-full">
              <label className="block mb-2 text-xs uppercase opacity-70">2FA / TOTP Code</label>
              <div className="relative">
                <KeyRound className="absolute w-4 h-4 opacity-50 left-3 top-3" />
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="w-full bg-[#00FFA3]/5 border border-[#00FFA3]/30 rounded p-2 pl-10 text-[#00FFA3] focus:outline-none focus:border-[#00FFA3] text-center tracking-[0.5em] text-lg font-bold"
                  placeholder="000000"
                  maxLength={6}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-[#00FFA3]/10 hover:bg-[#00FFA3]/20 border border-[#00FFA3]/50 p-3 font-bold tracking-widest uppercase rounded transition-all hover:shadow-[0_0_15px_#00FFA3]"
            >
              Authenticate Uplink
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
