"use client";

import React from "react";
import { AlertTriangle, ShieldCheck, ShieldAlert, Activity, Bell, Zap, History } from "lucide-react";

export default function RiskAuditPage() {
  const alerts = [
    { id: "alt_1", type: "Budget Warning", severity: "medium", message: "Agent 'ResearchBot-01' has reached 80% of its daily budget.", time: "10 mins ago" },
    { id: "alt_2", type: "Rate Limit", severity: "low", message: "Service 'GPT-4o' is approaching rate limits for your credential.", time: "45 mins ago" },
    { id: "alt_3", type: "Security Alert", severity: "high", message: "Unusual invocation pattern detected from IP 192.168.1.105.", time: "2 hours ago" },
  ];

  const auditLogs = [
    { id: "aud_1", action: "Credential Created", actor: "Owner (0x123...)", target: "ResearchBot-01", time: "1 day ago" },
    { id: "aud_2", action: "Budget Updated", actor: "Owner (0x123...)", target: "CreativeAgent", time: "2 days ago" },
    { id: "aud_3", action: "Vault Deposit", actor: "Owner (0x123...)", target: "Vault Contract", time: "3 days ago" },
  ];

  const getAlertTone = (severity: string) => {
    if (severity === "high") {
      return {
        badge: "bg-red-500/10 border border-red-500/20",
        icon: "text-red-400",
      };
    }
    if (severity === "medium") {
      return {
        badge: "bg-amber-500/10 border border-amber-500/20",
        icon: "text-amber-400",
      };
    }
    return {
      badge: "bg-blue-500/10 border border-blue-500/20",
      icon: "text-blue-400",
    };
  };

  return (
    <div className="p-8 space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-amber-400" />
            Risk & Audit
          </h1>
          <p className="text-sm text-gray-500 mt-1">Monitor platform security, budget compliance, and operational integrity.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-bold text-white hover:bg-white/10 transition-colors">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            Notification Settings
          </button>
        </div>
      </div>

      {/* RISK OVERVIEW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Secure</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">System Integrity</h3>
          <p className="text-xs text-gray-500">All security protocols are active and operational.</p>
        </div>
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Warning</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Budget Compliance</h3>
          <p className="text-xs text-gray-500">2 agents are approaching their daily budget limits.</p>
        </div>
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Activity className="w-4 h-4 text-blue-400" />
            </div>
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Normal</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Anomaly Detection</h3>
          <p className="text-xs text-gray-500">No unusual invocation patterns detected in 24h.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* ACTIVE ALERTS */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Active Alerts
            </h2>
            <button className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-widest">Clear All</button>
          </div>
          
          <div className="space-y-4">
            {alerts.map((alert) => {
              const tone = getAlertTone(alert.severity);
              return (
              <div key={alert.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-start gap-4 group hover:bg-white/[0.04] transition-all">
                <div className={`p-2 rounded-lg mt-0.5 ${tone.badge}`}>
                  <ShieldAlert className={`w-4 h-4 ${tone.icon}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-bold text-white">{alert.type}</h4>
                    <span className="text-[10px] font-mono text-gray-600">{alert.time}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{alert.message}</p>
                </div>
              </div>
            );})}
          </div>
        </div>

        {/* AUDIT TRAIL */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-blue-400" />
              Audit Trail
            </h2>
            <button className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-widest">Export CSV</button>
          </div>
          
          <div className="bg-[#0a0a0c] border border-white/5 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Action</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Actor</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Target</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-white">{log.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500 font-mono">{log.actor}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{log.target}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-600">{log.time}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
