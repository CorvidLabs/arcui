/**
 * Arcron register group — same math as @corvidlabs/arcron js/src/upkeep.ts.
 * Box names are "u" + big-endian uint64. Notes on the two pays keep them
 * from serialising to the same txid when MBR equals funding.
 */
import type { TransactionSigner } from "algosdk";
import type { AlgodApp } from "./algod";
import { b64ToBytes, bytesToUtf8 } from "./arc56";
import { NETWORKS, type NetworkId } from "./networks";

export const BOX_MBR_FIXED = 2_500 + 400 * 139;
export const MIN_UPKEEP_FEE = 4_000;
export const SUGGESTED_UPKEEP_FEE = 10_000;
export const MIN_INTERVAL_ROUNDS = 10;
export const MAX_CALL_ARGS = 3;
export const CATCH_UP = 0;
export const SKIP_AHEAD = 1;
export const REGISTER_GROUP_SIZE = 3;
export const BOX_NAME_PREFIX = "u";

export function encodeCallArgs(callArgs: readonly Uint8Array[]): Uint8Array {
  const count = callArgs.length;
  const headerBytes = 2 + 2 * count;
  const bodies = callArgs.map((arg) => {
    const body = new Uint8Array(2 + arg.length);
    new DataView(body.buffer).setUint16(0, arg.length);
    body.set(arg, 2);
    return body;
  });
  const out = new Uint8Array(headerBytes + bodies.reduce((sum, body) => sum + body.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(0, count);
  let position = headerBytes;
  bodies.forEach((body, index) => {
    view.setUint16(2 + 2 * index, position - 2);
    out.set(body, position);
    position += body.length;
  });
  return out;
}

export function boxMbr(callArgs: readonly Uint8Array[]): number {
  return BOX_MBR_FIXED + 400 * encodeCallArgs(callArgs).length;
}

export function upkeepBoxName(id: bigint | number): Uint8Array {
  const name = new Uint8Array(9);
  name[0] = BOX_NAME_PREFIX.charCodeAt(0);
  new DataView(name.buffer).setBigUint64(1, BigInt(id));
  return name;
}

export function nextUpkeepIdFromApp(app: AlgodApp): bigint {
  for (const entry of app.params["global-state"] ?? []) {
    const name = bytesToUtf8(b64ToBytes(entry.key));
    if (name === "next_upkeep_id") return BigInt(entry.value.uint ?? 0);
  }
  return 0n;
}

export type RegistrationCost = {
  boxDeposit: number;
  escrow: number;
  networkFees: number;
  total: number;
};

export function registrationCost(opts: {
  callArgs: readonly Uint8Array[];
  funding: number;
  minFee: number;
}): RegistrationCost {
  const boxDeposit = boxMbr(opts.callArgs);
  const networkFees = opts.minFee * REGISTER_GROUP_SIZE;
  return {
    boxDeposit,
    escrow: opts.funding,
    networkFees,
    total: boxDeposit + opts.funding + networkFees,
  };
}

export type RegisterParams = {
  targetApp: number;
  callArgs: readonly Uint8Array[];
  intervalRounds: number;
  feePerExecution: number;
  funding: number;
  policy: number;
  feeCap: number;
  feeAsset: number;
  assetFee: number;
};

export type Signing = {
  sender: string;
  signer: TransactionSigner;
};

export async function registerUpkeep(
  network: NetworkId,
  keeperAppId: number,
  signing: Signing,
  params: RegisterParams,
  nextId: bigint,
): Promise<{ txId: string; returnValue?: string }> {
  const algosdk = await import("algosdk");
  const client = new algosdk.Algodv2("", NETWORKS[network].algod, "");
  const suggestedParams = await client.getTransactionParams().do();
  const appAddress = algosdk.getApplicationAddress(keeperAppId);
  const composer = new algosdk.AtomicTransactionComposer();

  const payment = (amount: number, leg: string) => ({
    txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: signing.sender,
      receiver: appAddress,
      amount,
      suggestedParams,
      note: new TextEncoder().encode(`arcron:${leg}`),
    }),
    signer: signing.signer,
  });

  const method = new algosdk.ABIMethod({
    name: "register",
    args: [
      { name: "mbr_payment", type: "pay" },
      { name: "funding_payment", type: "pay" },
      { name: "target_app", type: "uint64" },
      { name: "call_args", type: "byte[][]" },
      { name: "interval_rounds", type: "uint64" },
      { name: "fee_per_execution", type: "uint64" },
      { name: "policy", type: "uint64" },
      { name: "fee_cap", type: "uint64" },
      { name: "fee_asset", type: "uint64" },
      { name: "asset_fee", type: "uint64" },
    ],
    returns: { type: "uint64" },
  });

  composer.addMethodCall({
    appID: keeperAppId,
    method,
    sender: signing.sender,
    signer: signing.signer,
    suggestedParams,
    methodArgs: [
      payment(boxMbr(params.callArgs), "mbr"),
      payment(params.funding, "funding"),
      params.targetApp,
      params.callArgs.map((arg) => Array.from(arg)),
      params.intervalRounds,
      params.feePerExecution,
      params.policy,
      params.feeCap,
      params.feeAsset,
      params.assetFee,
    ],
    boxes: [{ appIndex: 0, name: upkeepBoxName(nextId) }],
    appForeignApps: [params.targetApp],
  });

  const result = await composer.execute(client, 8);
  const returned = result.methodResults.at(-1);
  if (returned?.decodeError) throw returned.decodeError;
  return {
    txId: result.txIDs.at(-1) ?? "",
    returnValue: returned?.returnValue != null ? String(returned.returnValue) : undefined,
  };
}

export async function submitNoOpCall(opts: {
  network: NetworkId;
  appId: number;
  sender: string;
  signer: TransactionSigner;
  appArgs: Uint8Array[];
}): Promise<{ txId: string }> {
  const algosdk = await import("algosdk");
  const client = new algosdk.Algodv2("", NETWORKS[opts.network].algod, "");
  const suggestedParams = await client.getTransactionParams().do();
  const composer = new algosdk.AtomicTransactionComposer();
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: opts.sender,
    appIndex: opts.appId,
    appArgs: opts.appArgs,
    suggestedParams,
  });
  composer.addTransaction({ txn, signer: opts.signer });
  const result = await composer.execute(client, 8);
  return { txId: result.txIDs.at(-1) ?? "" };
}
