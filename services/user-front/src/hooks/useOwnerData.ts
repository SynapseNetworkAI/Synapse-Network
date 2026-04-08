"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getV2Balance } from "@/utils/balanceApi";
import { listUsageLogs, type UsageLogRecord } from "@/utils/usageApi";
import { clearAuthSession } from "@/utils/authSession";
import { useAuth } from "@/components/WalletAuthGuard";

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

export type OwnerStats = {
	ownerBalance: string;
	todaySpend: string;
	todayCalls: number;
	blockedCalls: number;
};

export function useOwnerData() {
	const { address: userAddress, isConnected } = useAccount();
	const { isSessionAuthenticated } = useAuth();
	const [isBootstrapping, setIsBootstrapping] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);

	const [stats, setStats] = useState<OwnerStats>({
		ownerBalance: "0.00",
		todaySpend: "0.00",
		todayCalls: 0,
		blockedCalls: 0,
	});

	const [logs, setLogs] = useState<UsageLogRecord[]>([]);

	const fetchOwnerData = useCallback(async (addr: string) => {
		if (!addr) return;
		try {
			const [balanceSummary, usageLogs] = await Promise.all([
				getV2Balance(addr),
				listUsageLogs(addr, 500).catch((logErr) => {
					console.warn("Failed to fetch owner-scoped logs:", logErr);
					return [] as UsageLogRecord[];
				}),
			]);

			const ownerLogs = usageLogs.filter(
				(log) => (log.ownerAddress || "").toLowerCase() === addr.toLowerCase()
			);
			const todayKey = Math.floor(Date.now() / 1000 / 86400);

			let todayCalls = 0;
			let blockedCalls = 0;

			ownerLogs.forEach((log) => {
				if (log.created_at) {
					const logDay = Math.floor(log.created_at / 86400);
					if (logDay === todayKey) {
						todayCalls++;
						if (log.status !== "succeeded" && log.status !== "accepted") {
							blockedCalls++;
						}
					}
				}
			});

			setStats({
				ownerBalance: (balanceSummary.ownerBalance || 0).toFixed(2),
				todaySpend: "0.00",
				todayCalls,
				blockedCalls,
			});

			setLogs(ownerLogs);
		} catch (error) {
			console.error("Failed to fetch owner data:", error);
			const message = error instanceof Error ? error.message : String(error);
			if (message === WALLET_SESSION_MISSING_MESSAGE || message.includes("auth session missing") || message.includes("401")) {
				clearAuthSession();
			}
		}
	}, []);

	useEffect(() => {
		let isActive = true;

		const bootstrapOwnerData = async () => {
			if (isConnected && userAddress && isSessionAuthenticated) {
				setIsBootstrapping(true);
				try {
					await fetchOwnerData(userAddress);
				} finally {
					if (isActive) {
						setIsBootstrapping(false);
					}
				}
				return;
			}

			setIsBootstrapping(false);
			setStats({
				ownerBalance: "0.00",
				todaySpend: "0.00",
				todayCalls: 0,
				blockedCalls: 0,
			});
			setLogs([]);
		};

		void bootstrapOwnerData();

		return () => {
			isActive = false;
		};
	}, [isConnected, isSessionAuthenticated, userAddress, fetchOwnerData]);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		if (isConnected && userAddress && isSessionAuthenticated) {
			await fetchOwnerData(userAddress);
		}
		setTimeout(() => setIsRefreshing(false), 500);
	}, [isConnected, isSessionAuthenticated, userAddress, fetchOwnerData]);

	return {
		userAddress,
		isBootstrapping,
		isRefreshing,
		stats,
		logs,
		handleRefresh,
	};
}