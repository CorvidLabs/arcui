import type { TransactionSigner } from "algosdk";
import { WalletManager, type WalletAdapterConfig } from "@txnlab/use-wallet";
import { defly } from "@txnlab/use-wallet-defly";
import { exodus } from "@txnlab/use-wallet-exodus";
import { kibisis } from "@txnlab/use-wallet-kibisis";
import { lute } from "@txnlab/use-wallet-lute";
import { pera } from "@txnlab/use-wallet-pera";
import type { NetworkId } from "./networks";
import { NETWORKS } from "./networks";

if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { global?: typeof globalThis };
  if (g.global === undefined) g.global = g;
}

export type WalletOption = {
  id: string;
  name: string;
  icon: string | null;
  connected: boolean;
  active: boolean;
  addresses: readonly string[];
};

let manager: WalletManager | null = null;

export function isEmbeddedPreview() {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

/** Wallets that hold real accounts and need no project id. Same set as Arcron. */
export function publicWallets(): WalletAdapterConfig[] {
  return [pera(), defly(), lute(), exodus(), kibisis()];
}

/** Network configuration in the shape use-wallet's manager expects. */
export function managerNetworks() {
  return {
    testnet: {
      algod: {
        token: "",
        baseServer: NETWORKS.testnet.algod,
        port: 443,
      },
      genesisId: "testnet-v1.0",
      isTestnet: true,
    },
    mainnet: {
      algod: {
        token: "",
        baseServer: NETWORKS.mainnet.algod,
        port: 443,
      },
      genesisId: "mainnet-v1.0",
    },
  };
}

export function isDismissal(cause: unknown): boolean {
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  return (
    message.includes("closed") ||
    message.includes("cancel") ||
    message.includes("rejected") ||
    message.includes("declined")
  );
}

export function snapshotWallets(m: WalletManager): WalletOption[] {
  return m.wallets.map((wallet) => ({
    id: String(wallet.id),
    name: wallet.metadata?.name ?? String(wallet.id),
    icon: wallet.metadata?.icon ?? null,
    connected: wallet.isConnected,
    active: wallet.isActive,
    addresses: (wallet.accounts ?? []).map((account) => account.address),
  }));
}

export function getWalletManager(network: NetworkId): WalletManager {
  if (typeof window === "undefined") {
    throw new Error("Wallets only exist in the browser");
  }
  if (!manager) {
    manager = new WalletManager({
      wallets: publicWallets(),
      networks: managerNetworks(),
      defaultNetwork: network,
      options: { persistNetwork: false },
    });
  }
  return manager;
}

export async function ensureWalletNetwork(network: NetworkId): Promise<WalletManager> {
  const m = getWalletManager(network);
  if (m.activeNetwork !== network) {
    await m.setActiveNetwork(network);
  }
  return m;
}

export async function resumeWallet(network: NetworkId): Promise<string | null> {
  try {
    const m = getWalletManager(network);
    await m.resumeSessions();
    if (m.activeNetwork !== network) await m.setActiveNetwork(network);
    return m.activeAddress ?? null;
  } catch {
    return null;
  }
}

export async function connectWalletId(network: NetworkId, walletId: string): Promise<string> {
  const m = await ensureWalletNetwork(network);
  const wallet = m.wallets.find((candidate) => String(candidate.id) === walletId);
  if (!wallet) throw new Error(`Unknown wallet: ${walletId}`);
  for (const other of m.wallets) {
    if (other.isConnected && other.id !== wallet.id) await other.disconnect();
  }
  if (wallet.isConnected) wallet.setActive();
  else await wallet.connect();
  const address = m.activeAddress;
  if (!address) throw new Error("Wallet returned no account");
  return address;
}

export async function disconnectWallet() {
  if (!manager) return;
  try {
    await manager.disconnect();
  } catch {
    /* already gone */
  }
}

export function setActiveWalletAccount(address: string) {
  manager?.activeWallet?.setActiveAccount(address);
}

export function walletSigner(): TransactionSigner {
  if (!manager?.activeAddress) throw new Error("Wallet is not connected");
  return manager.transactionSigner;
}

export function activeWalletAddress(): string | null {
  return manager?.activeAddress ?? null;
}
