import { createPublicClient, createWalletClient, custom, http, parseUnits } from "viem";
import type { Address, EIP1193Provider, Hash } from "viem";
import contractConfig from "@/contract-config.json";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import MockUSDCABI from "@/MockUSDCABI.json";

export type PayForServiceInput = {
  provider: Address;
  serviceId: string;
  priceUsdc: string;
  token?: Address;
  owner?: Address;
  rpcUrl?: string;
  decimals?: number;
};

const ensureWalletTransport = () => {
  const injectedEthereum = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!injectedEthereum) {
    throw new Error("No injected wallet found. Please install MetaMask or use a web3 wallet.");
  }
  return custom(injectedEthereum);
};

const normalizeAddress = (value: string): Address => value as Address;

export async function payForServiceWithApproval(input: PayForServiceInput): Promise<Hash> {
  const {
    provider,
    serviceId,
    priceUsdc,
    token = normalizeAddress(contractConfig.MockUSDC),
    owner,
    rpcUrl = "http://127.0.0.1:8545",
    decimals = 18,
  } = input;

  const transport = ensureWalletTransport();
  const walletClient = createWalletClient({ transport });
  const [walletAddress] = owner ? [owner] : await walletClient.getAddresses();

  if (!walletAddress) {
    throw new Error("No wallet account available. Please connect wallet first.");
  }

  const chainId = await walletClient.getChainId();
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const amount = parseUnits(priceUsdc, decimals);
  const routerAddress = normalizeAddress(contractConfig.SynapseCore);
  const allowance = (await publicClient.readContract({
    address: token,
    abi: MockUSDCABI,
    functionName: "allowance",
    args: [walletAddress, routerAddress],
  })) as bigint;

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      account: walletAddress,
      address: token,
      abi: MockUSDCABI,
      functionName: "approve",
      args: [routerAddress, amount],
      chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
    });

    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const payHash = await walletClient.writeContract({
    account: walletAddress,
    address: routerAddress,
    abi: SynapseCoreABI,
    functionName: "payForService",
    args: [token, provider, amount, serviceId],
    chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
  });

  await publicClient.waitForTransactionReceipt({ hash: payHash });
  return payHash;
}
