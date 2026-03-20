"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAppRole } from "@/utils/roleStore";

export default function DashboardIndex() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const role = getAppRole();
    if (role === "PROVIDER") {
      router.replace("/provider/sell");
    } else if (role === "ADMIN") {
      router.replace("/dashboard/admin");
    } else {
      router.replace("/dashboard/overview");
    }
  }, [router]);

  if (!mounted) return null;
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-73px)]">
      <div className="animate-pulse text-green-500">Redirecting to workspace...</div>
    </div>
  );
}
