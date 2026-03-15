"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ShieldCheck, Zap, ReceiptText, ChevronDown, ArrowRight } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { discoverServices, getWalletRole, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { formatPricing } from "@/utils/pricing";
import RoleWarningModal from "@/components/RoleWarningModal";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function Home() {
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { t, tList } = useLanguage();
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [isServicesLoading, setIsServicesLoading] = useState(true);

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{ role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string, targetRoleStr: "Buyer" | "Seller" } | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadServices = async () => {
      try {
        setIsServicesLoading(true);
        const rows = await discoverServices();
        if (!mounted) return;
        const active = rows.filter((row) => row.isActive !== false).slice(0, 8);
        setServices(active);
      } catch {
        if (mounted) {
          setServices([]);
        }
      } finally {
        if (mounted) {
          setIsServicesLoading(false);
        }
      }
    };

    loadServices();
    return () => {
      mounted = false;
    };
  }, []);

  const handleEnterRole = async (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    if (!address) {
      setAppRole(role);
      router.push(path);
      return;
    }
    
    // Check wallet role to show warning if needed
    const walletRole = await getWalletRole(address);
    if (walletRole !== "UNKNOWN" && walletRole !== role) {
      setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
      setIsWarningOpen(true);
      return;
    }

    setAppRole(role);
    router.push(path);
  };

  const scrollToFeatures = () => {
    document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="bg-black text-white font-sans selection:bg-white selection:text-black">
      <RoleWarningModal
        isOpen={isWarningOpen}
        onDisconnect={() => {
          disconnect();
          setIsWarningOpen(false);
        }}
        targetRole={pendingRoute?.targetRoleStr || "Buyer"}
      />

      <main>
        {/* First Screen: Hero */}
        <section className="relative h-[100svh] flex flex-col items-center justify-center px-6 mx-auto max-w-7xl">
          <div className="text-center w-full flex flex-col items-center mt-[-10svh]">
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-[800] tracking-tighter text-white leading-[0.95] mb-5 max-w-5xl">
              {t("home.heroTitle")}
            </h1>
            <p className="text-base md:text-xl text-[#86868b] font-medium tracking-tight max-w-3xl leading-relaxed">
              {t("home.heroSubtitle")}
            </p>
            <p className="mt-4 text-xs md:text-sm uppercase tracking-[0.22em] text-gray-500">
              {t("home.heroTagline")}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-6 mt-12 md:mt-16 z-10">
            <button
              onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')}
              className="px-10 py-4 bg-white text-black rounded-full font-semibold text-lg hover:bg-gray-200 transition-colors shadow-[0_0_40px_rgba(255,255,255,0.1)]"
            >
              {t("home.buyerBtn")}
            </button>
            <button
              onClick={() => handleEnterRole('PROVIDER', '/dashboard/sell')}
              className="px-10 py-4 bg-transparent text-white border border-[#424245] rounded-full font-semibold text-lg hover:bg-[#1d1d1f] hover:border-white transition-colors"
            >
              {t("home.providerBtn")}
            </button>
          </div>

          <div className="w-full max-w-5xl mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 z-10">
            <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5 md:p-6">
              <p className="text-[11px] tracking-[0.18em] uppercase text-green-400/80 mb-2">{t("home.providerTitle")}</p>
              <h3 className="text-base md:text-lg font-semibold text-white">{t("home.providerHeadline")}</h3>
              <p className="mt-2 text-sm text-[#86868b] leading-relaxed">
                {t("home.providerBody")}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5 md:p-6">
              <p className="text-[11px] tracking-[0.18em] uppercase text-blue-400/80 mb-2">{t("home.consumerTitle")}</p>
              <h3 className="text-base md:text-lg font-semibold text-white">{t("home.consumerHeadline")}</h3>
              <p className="mt-2 text-sm text-[#86868b] leading-relaxed">
                {t("home.consumerBody")}
              </p>
            </div>
          </div>

          {/* Scroll Indicator */}
          <div 
            className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center opacity-40 hover:opacity-100 transition-opacity cursor-pointer animate-bounce"
            onClick={scrollToFeatures}
          >
            <span className="text-[10px] text-[#86868b] tracking-[0.2em] mb-2 font-medium uppercase">{t("home.explore")}</span>
            <ChevronDown className="w-5 h-5 text-[#86868b]" />
          </div>
        </section>

        {/* Second Screen: Problem / Solution + Features */}
        <section id="features" className="min-h-[100svh] bg-black flex flex-col items-center justify-center px-6 py-24 mx-auto max-w-7xl relative">

          <div className="w-full max-w-6xl mx-auto mb-10 text-center">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tighter mb-4 text-white">{t("home.islandTitle")}</h2>
            <p className="text-base md:text-lg text-[#86868b] max-w-3xl mx-auto leading-relaxed">
              {t("home.islandBody")}
            </p>
          </div>

          <div className="w-full max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-14">
            <div className="rounded-[1.5rem] border border-[#3b1f1f] bg-[#120808] p-6 md:p-8">
              <p className="text-xs tracking-[0.18em] uppercase text-red-300/80 mb-4">{t("home.problemTitle")}</p>
              <ul className="space-y-3 text-sm md:text-base text-[#d4b3b3] leading-relaxed">
                {tList("home.problemItems").map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-[1.5rem] border border-[#1f3b2d] bg-[#07120e] p-6 md:p-8">
              <p className="text-xs tracking-[0.18em] uppercase text-green-300/80 mb-4">{t("home.solutionTitle")}</p>
              <ul className="space-y-3 text-sm md:text-base text-[#b6d6c4] leading-relaxed">
                {tList("home.solutionItems").map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Feature Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl mx-auto">
            {/* Card 1 */}
            <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2rem] p-8 md:p-10 hover:bg-[#111111] hover:border-[#444444] transition-all duration-300">
              <ShieldCheck className="w-8 h-8 text-white mb-6" />
              <h3 className="text-xl md:text-2xl font-semibold mb-4 text-white tracking-tight">{t("home.safetyTitle")}</h3>
              <p className="text-[#86868b] leading-relaxed text-sm md:text-base font-medium">
                {t("home.safetyBody")}
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2rem] p-8 md:p-10 hover:bg-[#111111] hover:border-[#444444] transition-all duration-300">
              <Zap className="w-8 h-8 text-white mb-6" />
              <h3 className="text-xl md:text-2xl font-semibold mb-4 text-white tracking-tight">{t("home.speedTitle")}</h3>
              <p className="text-[#86868b] leading-relaxed text-sm md:text-base font-medium">
                {t("home.speedBody")}
              </p>
            </div>

            {/* Card 3 */}
            <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2rem] p-8 md:p-10 hover:bg-[#111111] hover:border-[#444444] transition-all duration-300">
              <ReceiptText className="w-8 h-8 text-white mb-6" />
              <h3 className="text-xl md:text-2xl font-semibold mb-4 text-white tracking-tight">{t("home.transparencyTitle")}</h3>
              <p className="text-[#86868b] leading-relaxed text-sm md:text-base font-medium">
                {t("home.transparencyBody")}
              </p>
            </div>
          </div>

          <div className="w-full max-w-6xl mt-14 rounded-[2rem] border border-[#222222] bg-[#0a0a0a] p-6 md:p-8">
            <h3 className="text-2xl md:text-3xl font-bold tracking-tight text-white">{t("home.registryTitle")}</h3>
            <p className="mt-3 text-sm md:text-base text-[#86868b] max-w-3xl leading-relaxed">{t("home.registryBody")}</p>

            {isServicesLoading ? (
              <p className="mt-8 text-sm text-gray-500">{t("home.loadingServices")}</p>
            ) : services.length === 0 ? (
              <p className="mt-8 text-sm text-gray-500">{t("home.registryEmpty")}</p>
            ) : (
              <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {services.map((service) => (
                  <article key={service.id || service.serviceId} className="rounded-xl border border-[#262626] bg-[#070707] p-4">
                    <p className="text-white text-sm font-semibold">
                      {service.serviceName || service.name || service.serviceId}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{t("home.serviceIdLabel")}: {service.serviceId}</p>
                    <p className="text-xs text-gray-400 mt-2 break-all">{service.endpoint}</p>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-green-400">{formatPricing(service.pricing)}</span>
                      <span className="text-gray-500">{service.role}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Explicit Explanation Text Moved Below Cards */}
          <div className="mx-auto max-w-4xl mt-20 text-center">
            <p className="text-lg md:text-2xl text-[#86868b] leading-relaxed tracking-wide font-medium">
              {t("home.finalLine")}
            </p>
            <button
              onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')}
              className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold text-black bg-green-500 hover:bg-green-400 transition-colors"
            >
              {t("home.startBuilding")} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
