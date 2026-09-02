import type { Transaction, TransactionSigner } from "algosdk";
import type { NetworkId } from "./networks";

if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { global?: typeof globalThis };
  if (g.global === undefined) g.global = g;
}

type PeraWallet = {
  connect: () => Promise<string[]>;
  disconnect: () => Promise<void>;
  reconnectSession: () => Promise<string[]>;
  signTransaction: (
    groups: { txn: Transaction; signers?: string[] }[][],
    signerAddress?: string,
  ) => Promise<Uint8Array[]>;
};

let pera: PeraWallet | null = null;
let peraNetwork: NetworkId | null = null;

export function isEmbeddedPreview() {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

async function loadPera(network: NetworkId): Promise<PeraWallet> {
  if (pera && peraNetwork === network) return pera;
  if (pera) {
    try {
      await pera.disconnect();
    } catch {
      /* already gone */
    }
    pera = null;
  }
  const { PeraWalletConnect } = await import("@perawallet/connect");
  pera = new PeraWalletConnect({
    chainId: network === "mainnet" ? 416001 : 416002,
    shouldShowSignTxnToast: true,
  }) as unknown as PeraWallet;
  peraNetwork = network;
  return pera;
}

export async function connectWallet(network: NetworkId): Promise<string> {
  const wallet = await loadPera(network);
  try {
    const accounts = await wallet.connect();
    const address = accounts[0];
    if (!address) throw new Error("Pera returned no account");
    return address;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/closed|cancel|reject|declin/i.test(message)) throw new Error("Connect cancelled");
    throw err instanceof Error ? err : new Error(message);
  }
}

export async function reconnectWallet(network: NetworkId): Promise<string | null> {
  try {
    const wallet = await loadPera(network);
    const accounts = await wallet.reconnectSession();
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

export async function disconnectWallet() {
  try {
    await pera?.disconnect();
  } catch {
    /* already gone */
  }
  pera = null;
  peraNetwork = null;
}

export function peraSigner(sender: string): TransactionSigner {
  return async (txnGroup, indexesToSign) => {
    if (!pera) throw new Error("Wallet is not connected");
    const grouped = txnGroup.map((txn, i) => ({
      txn,
      signers: indexesToSign.includes(i) ? [sender] : [],
    }));
    return pera.signTransaction([grouped], sender);
  };
}
