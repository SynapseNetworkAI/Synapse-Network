"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Key, ShieldCheck, Activity, Copy, CheckCircle2, FileCode2, Plus, Trash2, Info, X } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import XSelect from "@/components/xui/XSelect";

import { listApiSecrets, createApiSecret, deleteApiSecret, ProviderSecret } from "@/utils/serviceApi";

type SecretSnippetTab = "python" | "node" | "java";

function buildNodeSnippet(isChinese: boolean): string {
  return `const crypto = require('crypto');
const express = require('express');
const app = express();

const SECRET_KEY = process.env.A2APAY_HMAC_SECRET;

app.post('/api/agent', express.json(), (req, res) => {
  const signature = req.headers['x-synapse-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: '${isChinese ? "签名无效" : "Invalid signature"}' });
  }

  ${isChinese ? "// 签名通过，继续处理业务请求..." : "// Signature valid, process message..."}
  res.json({ reply: '${isChinese ? "来自安全 Agent 的响应" : "Hello from secure agent"}' });
});

${isChinese ? "// Synapse Gateway 要求的健康检查端点" : "// Health check endpoint required by Synapse Gateway"}
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.listen(8080);`;
}

function buildPythonSnippet(isChinese: boolean): string {
  return `import hmac
import hashlib
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET_KEY = b"your_secret_key"

@app.post("/api/agent")
async def agent_endpoint(request: Request):
    signature = request.headers.get("x-synapse-signature")
    body = await request.body()

    ${isChinese ? "# 校验 HMAC SHA-256 签名" : "# Verify HMAC SHA-256"}
    expected_mac = hmac.new(SECRET_KEY, body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_mac, signature):
        raise HTTPException(status_code=401, detail="${isChinese ? "签名无效" : "Invalid signature"}")

    ${isChinese ? "# 签名通过，处理业务请求" : "# Process valid request"}
    return {"reply": "${isChinese ? "安全响应" : "Secure response"}"}

${isChinese ? "# Gateway 要求的健康检查端点" : "# Health check endpoint required by Gateway"}
@app.get("/health")
def health_check():
    return {"status": "healthy"}
`;
}

function buildJavaSnippet(isChinese: boolean): string {
  return String.raw`import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;

@RestController
public class AgentController {
    private final String SECRET_KEY = System.getenv("A2APAY_HMAC_SECRET");

    @PostMapping("/api/agent")
    public ResponseEntity<?> handleRequest(
            @RequestHeader("x-synapse-signature") String signature,
            @RequestBody String body) throws Exception {

        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec secret_key = new SecretKeySpec(
            SECRET_KEY.getBytes(), "HmacSHA256"
        );
        sha256_HMAC.init(secret_key);

        byte[] bytes = sha256_HMAC.doFinal(body.getBytes());
        StringBuilder hash = new StringBuilder();
        for (byte b : bytes) {
            hash.append(String.format("%02x", b));
        }

        if (!hash.toString().equals(signature)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                               .body("${isChinese ? "签名无效" : "Invalid signature"}");
        }

        return ResponseEntity.ok("{\\"reply\\":\\"${isChinese ? "安全响应" : "Secure response"}\\"}");
    }

    @GetMapping("/health")
    public ResponseEntity<?> healthCheck() {
        return ResponseEntity.ok("{\\"status\\":\\"healthy\\"}");
    }
}
`;
}

export default function SecretsPage() {
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  const { t, lang } = useLanguage();
  const [secrets, setSecrets] = useState<ProviderSecret[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SecretSnippetTab>("node");
  const [loading, setLoading] = useState(false);
  const [newSecretName, setNewSecretName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [qpsLimit, setQpsLimit] = useState<string>("");
  const [expiration, setExpiration] = useState("never");

  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const isChinese = lang === "zh";
  const expirationOptions = useMemo(() => ([
    { value: "never", label: t("providerSecretsPage.modalExpirationNever") },
    { value: "30", label: t("providerSecretsPage.modalExpiration30Days") },
    { value: "60", label: t("providerSecretsPage.modalExpiration60Days") },
    { value: "90", label: t("providerSecretsPage.modalExpiration90Days") },
  ]), [t]);
  const snippets = useMemo(() => ({
    node: buildNodeSnippet(isChinese),
    python: buildPythonSnippet(isChinese),
    java: buildJavaSnippet(isChinese),
  }), [isChinese]);

  const getErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return t("providerSecretsPage.unknownError");
  }, [t]);

  useEffect(() => {
    async function init() {
      if (!address || !isSessionAuthenticated) {
        setSecrets([]);
        return;
      }
      try {
        setLoading(true);
        const data = await listApiSecrets(address as string);
        setSecrets(data || []);
      } catch (error: unknown) {
        console.error("ERROR Loading secrets:", error);
        const msg = getErrorMessage(error);
        if (!msg.includes("Wallet auth") && !msg.toLowerCase().includes("token expired")) {
          toast.error(t("providerSecretsPage.loadFailed", { message: msg }));
        }
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [address, getErrorMessage, isSessionAuthenticated, t]);

  const handleCreateSecret = async () => {
    if (!address || !isSessionAuthenticated) {
      toast(t("providerSecretsPage.signInFirst"), { icon: "🔐" });
      return;
    }
    const finalName = newSecretName.trim() || t("providerSecretsPage.defaultSecretName", { index: secrets.length + 1 });
    try {
      setIsCreating(true);
      const rpm = qpsLimit.trim() ? Number.parseInt(qpsLimit, 10) : null;
      const expirationDays = expiration === "never" ? null : Number.parseInt(expiration, 10);
      const expirationTs = expirationDays && expirationDays > 0
        ? Math.floor(Date.now() / 1000) + expirationDays * 24 * 3600
        : null;

      const newSecret = await createApiSecret(finalName, address as string, null, null, expirationTs, rpm);

      setSecrets([newSecret, ...secrets]);
      toast.success(t("providerSecretsPage.createdSuccess"));
      setNewSecretName("");
      setQpsLimit("");
      setExpiration("never");
      setIsModalOpen(false);
    } catch (error: unknown) {
      console.error("ERROR Loading secrets:", error);
      const msg = getErrorMessage(error);
      if (!msg.includes("Wallet auth") && !msg.toLowerCase().includes("token expired")) {
        toast.error(t("providerSecretsPage.createFailed", { message: msg }));
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSecret = async (id: string) => {
    if (!address || !isSessionAuthenticated) {
      toast(t("providerSecretsPage.signInFirst"), { icon: "🔐" });
      return;
    }
    if (!confirm(t("providerSecretsPage.confirmRevoke"))) return;
    try {
      await deleteApiSecret(id, address as string);
      setSecrets(secrets.filter((secret) => secret.id !== id));
      toast.success(t("providerSecretsPage.deletedSuccess"));
    } catch (error: unknown) {
      console.error("ERROR Loading secrets:", error);
      toast.error(t("providerSecretsPage.deleteFailed"));
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success(t("providerSecretsPage.copiedSuccess"));
    setTimeout(() => setCopied(null), 2000);
  };

  const handleOpenCreateSecretModal = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!isSessionAuthenticated) {
      const ok = await authorize();
      if (!ok) {
        return;
      }
    }

    setIsModalOpen(true);
  };

  let secretListContent: React.ReactNode;
  if (loading) {
    secretListContent = (
      <div className="py-8 text-center font-mono text-gray-500 animate-pulse">
        {t("providerSecretsPage.loading")}
      </div>
    );
  } else if (secrets.length === 0) {
    secretListContent = (
      <div className="py-8 text-center font-mono text-gray-500">
        {address
          ? t("providerSecretsPage.emptyConnected")
          : t("providerSecretsPage.emptyDisconnected")}
      </div>
    );
  } else {
    secretListContent = (
      <div className="space-y-4">
        {secrets.map((sec) => (
          <div key={sec.id} className="group flex flex-col justify-between rounded-lg border border-gray-800/80 bg-gray-950/50 p-4 transition-colors hover:border-green-500/30 md:flex-row md:items-center">
            <div className="mb-4 flex gap-4 md:mb-0 md:items-center">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-green-500/20 bg-green-500/10">
                <Key className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">{sec.name}</h3>
                <div className="mt-1 flex items-center gap-2 text-xs font-mono text-gray-400">
                  {t("providerSecretsPage.createdAt", { date: new Date(sec.createdAt).toLocaleDateString(locale) })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4 rounded-md border border-gray-800 bg-gray-900 px-4 py-2">
                <span className="font-mono text-sm tracking-wider text-emerald-400">
                  {sec.secretKey || sec.maskedKey}
                </span>
                {sec.secretKey && (
                  <button
                    onClick={() => sec.secretKey && copyToClipboard(sec.secretKey, sec.id)}
                    className="text-gray-500 transition-colors hover:text-white"
                    title={t("providerSecretsPage.copySecret")}
                  >
                    {copied === sec.id ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                )}
              </div>

              <button
                onClick={() => handleDeleteSecret(sec.id)}
                className="rounded border border-transparent p-2 text-gray-500 transition-colors hover:border-red-900/50 hover:bg-red-900/20 hover:text-red-400"
                title={t("providerSecretsPage.revokeSecret")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {isModalOpen && (
        <div className="x-dialog-shell x-modal-overlay">
          <div className="x-modal-flat x-modal-surface max-w-md border border-gray-800 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="x-modal-header border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{t("providerSecretsPage.modalTitle")}</h2>
              <button onClick={() => setIsModalOpen(false)} className="x-modal-close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="x-modal-body space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="secret-name" className="text-sm font-medium text-gray-200">{t("providerSecretsPage.modalNameLabel")}</label>
                  <div className="group relative flex items-center">
                    <Info className="h-4 w-4 cursor-help text-gray-500" />
                    <div className="absolute bottom-full z-10 mb-2 hidden w-48 rounded border border-gray-700 bg-gray-800 p-2 text-xs text-gray-200 shadow-lg group-hover:block">
                      {t("providerSecretsPage.modalNameTooltip")}
                    </div>
                  </div>
                </div>
                <input
                  id="secret-name"
                  type="text"
                  value={newSecretName}
                  onChange={(event) => setNewSecretName(event.target.value)}
                  placeholder={t("providerSecretsPage.modalNamePlaceholder")}
                  className="w-full rounded-md border border-gray-800 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none transition-all placeholder:text-gray-600 focus:border-green-500 focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="secret-qps" className="text-sm font-medium text-gray-200">{t("providerSecretsPage.modalRateLimitLabel")}</label>
                  <div className="group relative flex items-center">
                    <Info className="h-4 w-4 cursor-help text-gray-500" />
                    <div className="absolute bottom-full z-10 mb-2 hidden w-48 rounded border border-gray-700 bg-gray-800 p-2 text-xs text-gray-200 shadow-lg group-hover:block">
                      {t("providerSecretsPage.modalRateLimitTooltip")}
                    </div>
                  </div>
                </div>
                <input
                  id="secret-qps"
                  type="number"
                  value={qpsLimit}
                  onChange={(event) => setQpsLimit(event.target.value)}
                  placeholder={t("providerSecretsPage.modalRateLimitPlaceholder")}
                  className="w-full rounded-md border border-gray-800 bg-[#0A0A0A] px-3 py-2 text-sm text-white outline-none transition-all focus:border-green-500 focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="secret-expiration" className="text-sm font-medium text-gray-200">{t("providerSecretsPage.modalExpirationLabel")}</label>
                  <div className="group relative flex items-center">
                    <Info className="h-4 w-4 cursor-help text-gray-500" />
                    <div className="absolute bottom-full z-10 mb-2 hidden w-48 rounded border border-gray-700 bg-gray-800 p-2 text-xs text-gray-200 shadow-lg group-hover:block">
                      {t("providerSecretsPage.modalExpirationTooltip")}
                    </div>
                  </div>
                </div>
                <XSelect
                  id="secret-expiration"
                  value={expiration}
                  onChange={(next) => setExpiration(next)}
                  options={expirationOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  triggerClassName="inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-gray-800 bg-[#0A0A0A] px-3 py-2 text-sm text-white transition-all focus:border-green-500 focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="x-modal-footer border-t border-gray-800 bg-gray-900/50">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-300 transition-colors hover:text-white"
                disabled={isCreating}
              >
                {t("providerSecretsPage.cancel")}
              </button>
              <button
                onClick={handleCreateSecret}
                disabled={isCreating || !newSecretName.trim()}
                className="rounded-md bg-white px-6 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? t("providerSecretsPage.issuing") : t("providerSecretsPage.issueCredential")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl space-y-8 p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start justify-between border-b border-gray-800 pb-4">
          <div>
            <h1 className="mb-2 flex items-center gap-3 font-mono text-3xl font-bold tracking-tight text-white">
              <Key className="h-8 w-8 text-green-400" />
              {t("providerSecretsPage.title")}
            </h1>
            <p className="max-w-2xl text-gray-400">
              {t("providerSecretsPage.description")}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50 backdrop-blur-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-gray-800 p-6 md:flex-row md:items-center">
            <h2 className="flex items-center gap-2 font-mono text-xl text-white">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              {t("providerSecretsPage.activeCredentialsTitle")}
            </h2>
            <button
              onClick={handleOpenCreateSecretModal}
              className="flex items-center gap-2 rounded-md bg-green-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-green-600"
            >
              <Plus className="h-4 w-4" />
              {t("providerSecretsPage.issueSigningSecret")}
            </button>
          </div>
          <div className="p-6">
            {secretListContent}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur-sm">
              <h3 className="mb-4 flex items-center gap-2 font-mono text-lg text-white">
                <Activity className="h-5 w-5 text-purple-400" />
                {t("providerSecretsPage.howItWorksTitle")}
              </h3>
              <div className="space-y-4 text-sm text-gray-400">
                <p>{t("providerSecretsPage.howItWorksLead")}</p>
                <ul className="space-y-3">
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-green-400">1.</span>
                    <span>{t("providerSecretsPage.howItWorksStepOne")}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-green-400">2.</span>
                    <span>{t("providerSecretsPage.howItWorksStepTwo")}</span></li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 text-green-400">3.</span>
                    <span>{t("providerSecretsPage.howItWorksStepThree")}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 backdrop-blur-sm">
              <h3 className="mb-4 flex items-center gap-2 font-mono text-lg text-white">
                <Activity className="h-5 w-5 text-emerald-400" />
                {t("providerSecretsPage.healthCheckTitle")}
              </h3>
              <p className="mb-4 text-sm text-gray-400">
                {t("providerSecretsPage.healthCheckDescription")}
              </p>
              <div className="rounded-lg border border-gray-800 bg-black/60 p-3 font-mono text-xs">
                <div className="mb-1 text-emerald-400">GET /health</div>
                <div className="text-gray-500">{t("providerSecretsPage.expectedResponse")}</div>
                <div className="text-gray-300">{"{"}</div>
                <div className="text-gray-300">  &quot;status&quot;: &quot;healthy&quot;</div>
                <div className="text-gray-300">{"}"}</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-[#0A0A0A] backdrop-blur-sm">
              <div className="flex border-b border-gray-800 bg-gray-900/30">
                <button
                  onClick={() => setActiveTab("node")}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-xs font-medium font-mono transition-colors ${activeTab === "node" ? "border-b-2 border-green-400 bg-green-500/5 text-green-400" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <FileCode2 className="h-4 w-4" /> {t("providerSecretsPage.tabNode")}
                </button>
                <button
                  onClick={() => setActiveTab("python")}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-xs font-medium font-mono transition-colors ${activeTab === "python" ? "border-b-2 border-yellow-400 bg-yellow-500/5 text-yellow-400" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <FileCode2 className="h-4 w-4" /> {t("providerSecretsPage.tabPython")}
                </button>
                <button
                  onClick={() => setActiveTab("java")}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-xs font-medium font-mono transition-colors ${activeTab === "java" ? "border-b-2 border-red-400 bg-red-500/5 text-red-400" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <FileCode2 className="h-4 w-4" /> {t("providerSecretsPage.tabJava")}
                </button>
              </div>

              <div className="flex-1 overflow-x-auto p-6">
                <pre className="font-mono text-xs leading-relaxed text-gray-300">{snippets[activeTab]}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
