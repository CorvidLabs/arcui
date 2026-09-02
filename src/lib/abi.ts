import { abiArgs, isTxnType, type Arc56Method, type Arc56Spec } from "./arc56";
import { NETWORKS, type NetworkId } from "./networks";

function bytesToB64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function parseAbiValue(type: string, raw: string, structName?: string, spec?: Arc56Spec): unknown {
  const value = raw.trim();
  if (type === "bool") return value === "true" || value === "1";
  if (type === "address" || type === "account") return value;
  if (type === "string") return value;
  if (type === "byte[]" && !structName) {
    if (value.startsWith("0x")) {
      const hex = value.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    return new TextEncoder().encode(value);
  }
  if (type.startsWith("uint") || type === "asset" || type === "application") {
    if (!/^\d+$/.test(value)) throw new Error(`Expected integer for ${type}`);
    return BigInt(value);
  }
  if (type === "byte[][]") {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) throw new Error("byte[][] expects a JSON array of strings");
    return parsed.map((item) => {
      if (typeof item !== "string") throw new Error("byte[][] items must be strings");
      if (item.startsWith("0x")) {
        const hex = item.slice(2);
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return out;
      }
      return new TextEncoder().encode(item);
    });
  }
  if (structName && spec?.structs?.[structName]) {
    const obj = JSON.parse(value || "{}") as Record<string, unknown>;
    return spec.structs[structName].map((field) =>
      parseAbiValue(field.type, String(obj[field.name] ?? ""), undefined, spec),
    );
  }
  if (value.startsWith("[") || value.startsWith("{")) return JSON.parse(value);
  return value;
}

export async function buildMethodCall(spec: Arc56Spec, method: Arc56Method, values: Record<string, string>) {
  const algosdk = await import("algosdk");
  const abiMethod = new algosdk.ABIMethod({
    name: method.name,
    args: method.args.map((a) => ({ name: a.name ?? "", type: a.type })),
    returns: { type: method.returns?.type ?? "void" },
  });
  const selector = abiMethod.getSelector();
  const encoded: Uint8Array[] = [selector];
  for (const arg of method.args) {
    if (isTxnType(arg.type)) continue;
    const raw = values[arg.name ?? arg.type] ?? values[arg.name ?? ""] ?? "";
    const parsed = parseAbiValue(arg.type, raw, arg.struct, spec);
    const type = algosdk.ABIType.from(arg.struct ? structTuple(spec, arg.struct) : arg.type);
    encoded.push(type.encode(parsed as never));
  }
  return { selector, encoded, abiMethod, signature: abiMethod.getSignature() };
}

function structTuple(spec: Arc56Spec, name: string) {
  const fields = spec.structs?.[name];
  if (!fields) throw new Error(`Unknown struct ${name}`);
  return `(${fields.map((f) => f.type).join(",")})`;
}

export type SimulateResult = {
  ok: boolean;
  message: string;
  returnValue?: string;
  logs: string[];
};

function isFeeOnlyFailure(message: string) {
  return /overspend|fees is less than|min fee|fee too (small|low)/i.test(message);
}

export async function simulateMethod(
  network: NetworkId,
  appId: number,
  spec: Arc56Spec,
  method: Arc56Method,
  values: Record<string, string>,
  sender?: string,
): Promise<SimulateResult> {
  if (method.args.some((a) => isTxnType(a.type))) {
    return {
      ok: false,
      message:
        "This method needs a payment or asset transfer in the group. Simulate without a wallet is limited to methods that take no transactions.",
      logs: [],
    };
  }
  const built = await buildMethodCall(spec, method, values);
  const sim = await simulateInBrowser(network, appId, built.encoded, sender);
  const decoded = await decodeAbiReturn(sim.logs, method.returns?.type ?? "void");
  if (sim.failureMessage && !isFeeOnlyFailure(sim.failureMessage)) {
    return { ok: false, message: sim.failureMessage, logs: sim.logs, returnValue: decoded };
  }
  return {
    ok: true,
    message: decoded ? `returned ${decoded}` : "succeeded (no return)",
    returnValue: decoded,
    logs: sim.logs,
  };
}

async function simulateInBrowser(
  network: NetworkId,
  appId: number,
  appArgs: Uint8Array[],
  sender?: string,
) {
  const algosdk = await import("algosdk");
  const client = new algosdk.Algodv2("", NETWORKS[network].algod, "");
  const sp = await client.getTransactionParams().do();
  const from = sender ?? algosdk.generateAccount().addr;
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: from,
    appIndex: appId,
    appArgs,
    suggestedParams: {
      ...sp,
      flatFee: true,
      fee: sender ? sp.minFee ?? 1000n : 0n,
    },
  });
  const atc = new algosdk.AtomicTransactionComposer();
  atc.addTransaction({ txn, signer: algosdk.makeEmptyTransactionSigner() });
  const request = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [],
    allowEmptySignatures: true,
    allowUnnamedResources: true,
    extraOpcodeBudget: 20_000,
  });
  const sim = await atc.simulate(client, request);
  const group = sim.simulateResponse.txnGroups[0];
  const logs = group?.txnResults?.[0]?.txnResult?.logs ?? [];
  return {
    failureMessage: group?.failureMessage ?? "",
    logs: logs.map((l) => {
      const bytes = l instanceof Uint8Array ? l : Uint8Array.from(l as Iterable<number>);
      return bytesToB64(bytes);
    }),
  };
}

export async function decodeAbiReturn(logsB64: string[], type: string) {
  if (type === "void" || logsB64.length === 0) return undefined;
  const last = logsB64[logsB64.length - 1];
  let bytes: Uint8Array;
  try {
    const bin = atob(last);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return undefined;
  }
  const prefix = [0x15, 0x1f, 0x7c, 0x75];
  if (bytes.length < 4 || prefix.some((b, i) => bytes[i] !== b)) return undefined;
  const payload = bytes.slice(4);
  if (type === "string") {
    try {
      return new TextDecoder().decode(payload);
    } catch {
      return undefined;
    }
  }
  if (type.startsWith("uint") || type === "byte") {
    let n = 0n;
    for (const b of payload) n = (n << 8n) + BigInt(b);
    return n.toString();
  }
  if (type === "bool") return payload[payload.length - 1] ? "true" : "false";
  if (type === "address" || type === "account") {
    const algosdk = await import("algosdk");
    try {
      return algosdk.encodeAddress(payload);
    } catch {
      /* fall through */
    }
  }
  return `0x${Array.from(payload)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export { abiArgs };
