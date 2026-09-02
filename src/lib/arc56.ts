export type Arc56Arg = {
  name?: string;
  type: string;
  desc?: string;
  struct?: string;
  defaultValue?: { source: string; data: string };
};

export type Arc56Method = {
  name: string;
  desc?: string;
  args: Arc56Arg[];
  returns?: { type: string; desc?: string; struct?: string };
  readonly?: boolean;
  events?: string[];
  actions?: { create?: string[]; call?: string[] };
};

export type StorageKey = {
  key?: string;
  keyType?: string;
  valueType?: string;
  desc?: string;
};

export type Arc56Spec = {
  name: string;
  desc?: string;
  methods: Arc56Method[];
  structs?: Record<string, { name: string; type: string }[]>;
  state?: {
    schema?: {
      global?: { ints?: number; bytes?: number };
      local?: { ints?: number; bytes?: number };
    };
    keys?: {
      global?: Record<string, StorageKey>;
      local?: Record<string, StorageKey>;
      box?: Record<string, StorageKey>;
    };
    maps?: {
      global?: Record<string, StorageKey>;
      local?: Record<string, StorageKey>;
      box?: Record<string, StorageKey>;
    };
  };
  events?: { name: string; desc?: string; args?: Arc56Arg[] }[];
  networks?: Record<string, { appID: number }>;
};

export function parseSpec(raw: unknown): Arc56Spec {
  if (!raw || typeof raw !== "object") throw new Error("Spec is not an object");
  const spec = raw as Arc56Spec;
  if (!spec.name) throw new Error("Spec is missing name");
  if (!Array.isArray(spec.methods)) throw new Error("Spec is missing methods[]");
  return spec;
}

export function isTxnType(type: string) {
  return (
    type === "pay" ||
    type === "axfer" ||
    type === "acfg" ||
    type === "afrz" ||
    type === "appl" ||
    type === "keyreg" ||
    type === "stpf" ||
    type === "txn"
  );
}

export function methodSignature(method: Arc56Method) {
  const args = method.args.map((a) => a.type).join(",");
  const ret = method.returns?.type ?? "void";
  return `${method.name}(${args})${ret}`;
}

export function abiArgs(method: Arc56Method) {
  return method.args.filter((a) => !isTxnType(a.type));
}

export function txnArgs(method: Arc56Method) {
  return method.args.filter((a) => isTxnType(a.type));
}

const ADMIN_METHODS = new Set(["update", "freeze"]);

/** Creator/admin calls are not hooks. An Arcron upkeep must be a NoOp. */
export function isAdminMethod(method: Arc56Method) {
  if (ADMIN_METHODS.has(method.name)) return true;
  const calls = method.actions?.call ?? [];
  return calls.some((action) => action === "UpdateApplication" || action === "DeleteApplication");
}

/**
 * A method Arcron can register: NoOp, not readonly, no group txns, at most two
 * ABI args (selector + two args = MAX_CALL_ARGS 3).
 */
export function isSchedulable(method: Arc56Method) {
  if (method.readonly) return false;
  if (isAdminMethod(method)) return false;
  if (txnArgs(method).length > 0) return false;
  return abiArgs(method).length <= 2;
}

export function defaultArgValue(arg: Arc56Arg) {
  if (arg.defaultValue?.source === "literal" && typeof arg.defaultValue.data === "string") {
    return arg.defaultValue.data;
  }
  if (arg.type.startsWith("uint") || arg.type === "asset" || arg.type === "application") return "0";
  if (arg.type === "bool") return "false";
  return "";
}

export function methodKind(method: Arc56Method): "readonly" | "schedule" | "write" {
  if (method.readonly) return "readonly";
  if (isSchedulable(method)) return "schedule";
  return "write";
}

export type DecodedState = {
  key: string;
  label: string;
  kind: "uint" | "bytes";
  display: string;
  raw: string;
};

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function decodeGlobalState(
  entries: { key: string; value: { type: number; uint?: number; bytes?: string } }[],
  spec: Arc56Spec | null,
): DecodedState[] {
  const labels = spec?.state?.keys?.global ?? {};
  const byKey = new Map<string, string>();
  for (const [label, meta] of Object.entries(labels)) {
    if (meta.key) byKey.set(meta.key, label);
    byKey.set(label, label);
  }
  return entries.map((entry) => {
    const keyBytes = b64ToBytes(entry.key);
    const asText = bytesToUtf8(keyBytes);
    const printable = /^[\x20-\x7e]+$/.test(asText);
    const keyName = printable ? asText : `0x${bytesToHex(keyBytes)}`;
    const label = byKey.get(asText) ?? byKey.get(keyName) ?? keyName;
    if (entry.value.type === 2) {
      return {
        key: keyName,
        label,
        kind: "uint" as const,
        display: String(entry.value.uint ?? 0),
        raw: String(entry.value.uint ?? 0),
      };
    }
    const raw = entry.value.bytes ?? "";
    const valBytes = raw ? b64ToBytes(raw) : new Uint8Array();
    const text = bytesToUtf8(valBytes);
    const display = /^[\x20-\x7e]*$/.test(text) && text.length > 0 ? text : `0x${bytesToHex(valBytes)}`;
    return { key: keyName, label, kind: "bytes" as const, display, raw };
  });
}

export function frozenFromState(state: DecodedState[]) {
  const row = state.find((entry) => entry.label === "frozen" || entry.key === "frozen");
  if (!row) return null;
  return row.display === "1" || row.raw === "1";
}
