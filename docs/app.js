if (typeof globalThis !== "undefined" && globalThis.global === undefined) {
    globalThis.global = globalThis;
}

const NETWORKS = {
    testnet: {
        label: "TestNet",
        algod: "https://testnet-api.algonode.cloud",
        explorerApp: (id) => `https://testnet.explorer.perawallet.app/application/${id}`,
    },
    mainnet: {
        label: "MainNet",
        algod: "https://mainnet-api.algonode.cloud",
        explorerApp: (id) => `https://explorer.perawallet.app/application/${id}`,
    },
};

const ARCRON = {
    testnetAppId: 769891898,
    testnetPulseId: 769891902,
    console: "https://corvidlabs.xyz/arcron/console/",
    minFeeMicro: 4000,
    skipAhead: 1,
    catchUp: 0,
};

const BOX_MBR_FIXED = 2500 + 400 * 139;
const MIN_UPKEEP_FEE = 4000;
const REGISTER_GROUP_SIZE = 3;
const EXECUTIONS = 10;
const BOX_NAME_PREFIX = "u";
const ADMIN_METHODS = new Set(["update", "freeze"]);

const PRESETS = {
    keeper: { label: "Arcron Keeper", network: "testnet", appId: ARCRON.testnetAppId, specUrl: "./Keeper.arc56.json" },
    pulse: { label: "Pulse", network: "testnet", appId: ARCRON.testnetPulseId, specUrl: "./Pulse.arc56.json" },
};

const INTERVALS = [
    { label: "~1 minute", rounds: 23 },
    { label: "~5 minutes", rounds: 111 },
    { label: "~1 hour", rounds: 1286 },
    { label: "~1 day", rounds: 30857 },
];

const TXN_TYPES = new Set(["pay", "axfer", "acfg", "afrz", "appl", "keyreg", "stpf", "txn"]);

const $ = (id) => document.getElementById(id);

const state = {
    network: "testnet",
    spec: null,
    specText: "",
    app: null,
    global: [],
    boxes: [],
    openBox: null,
    round: null,
    values: {},
    results: {},
    interval: INTERVALS[2].rounds,
    feeAlgo: "0.01",
    policy: ARCRON.skipAhead,
    draft: null,
    scheduleFor: null,
    sdk: null,
    account: null,
    calling: null,
    filter: "",
    activePreset: "",
    registerBusy: false,
    registerResult: null,
    copiedSelector: null,
};

function isTxnType(type) {
    return TXN_TYPES.has(type);
}

function abiArgs(method) {
    return (method.args ?? []).filter((a) => !isTxnType(a.type));
}

function txnArgs(method) {
    return (method.args ?? []).filter((a) => isTxnType(a.type));
}

function isAdminMethod(method) {
    if (ADMIN_METHODS.has(method.name)) return true;
    const calls = method.actions?.call ?? [];
    return calls.some((action) => action === "UpdateApplication" || action === "DeleteApplication");
}

function isSchedulable(method) {
    if (method.readonly) return false;
    if (isAdminMethod(method)) return false;
    if (txnArgs(method).length > 0) return false;
    return abiArgs(method).length <= 2;
}

function methodKind(method) {
    if (method.readonly) return "readonly";
    if (isSchedulable(method)) return "schedule";
    return "write";
}

function methodSignature(method) {
    const args = (method.args ?? []).map((a) => a.type).join(",");
    const ret = method.returns?.type ?? "void";
    return `${method.name}(${args})${ret}`;
}

function defaultArgValue(arg) {
    if (arg.defaultValue?.source === "literal" && typeof arg.defaultValue.data === "string") {
        return arg.defaultValue.data;
    }
    if (typeof arg.type === "string" && (arg.type.startsWith("uint") || arg.type === "asset" || arg.type === "application")) {
        return "0";
    }
    if (arg.type === "bool") return "false";
    return "";
}

function seedValues(spec) {
    const seeded = {};
    for (const method of spec.methods ?? []) {
        const row = {};
        for (const arg of method.args ?? []) {
            const name = arg.name ?? arg.type;
            const def = defaultArgValue(arg);
            if (def) row[name] = def;
        }
        if (Object.keys(row).length) seeded[method.name] = row;
    }
    state.values = seeded;
}

function valuesFor(method) {
    const stored = state.values[method.name] ?? {};
    const out = { ...stored };
    for (const arg of method.args ?? []) {
        const name = arg.name ?? arg.type;
        if (out[name] == null || out[name] === "") {
            const def = defaultArgValue(arg);
            if (def) out[name] = def;
        }
    }
    return out;
}

function parseSpec(raw) {
    if (!raw || typeof raw !== "object") throw new Error("Spec is not an object");
    if (!raw.name) throw new Error("Spec is missing name");
    if (!Array.isArray(raw.methods)) throw new Error("Spec is missing methods[]");
    return raw;
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToUtf8(bytes) {
    try {
        return new TextDecoder().decode(bytes);
    } catch {
        return "";
    }
}

function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function hexOf(bytes) {
    return `0x${bytesToHex(bytes)}`;
}

function decodeGlobalState(entries, spec) {
    const labels = spec?.state?.keys?.global ?? {};
    const byKey = new Map();
    for (const [label, meta] of Object.entries(labels)) {
        if (meta.key) byKey.set(meta.key, label);
        byKey.set(label, label);
    }
    return (entries ?? []).map((entry) => {
        const keyBytes = b64ToBytes(entry.key);
        const asText = bytesToUtf8(keyBytes);
        const printable = /^[\x20-\x7e]+$/.test(asText);
        const keyName = printable ? asText : `0x${bytesToHex(keyBytes)}`;
        const label = byKey.get(asText) ?? byKey.get(keyName) ?? keyName;
        if (entry.value.type === 2) {
            return {
                key: keyName,
                label,
                kind: "uint",
                display: String(entry.value.uint ?? 0),
                raw: String(entry.value.uint ?? 0),
            };
        }
        const raw = entry.value.bytes ?? "";
        const valBytes = raw ? b64ToBytes(raw) : new Uint8Array();
        const text = bytesToUtf8(valBytes);
        const display = /^[\x20-\x7e]*$/.test(text) && text.length > 0 ? text : `0x${bytesToHex(valBytes)}`;
        return { key: keyName, label, kind: "bytes", display, raw };
    });
}

function frozenFromState(entries) {
    const row = entries.find((entry) => entry.label === "frozen" || entry.key === "frozen");
    if (!row) return null;
    return row.display === "1" || row.raw === "1";
}

function parseShareQuery(search) {
    const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const net = q.get("net");
    return {
        preset: q.get("preset"),
        app: q.get("app"),
        net: net === "mainnet" || net === "testnet" ? net : null,
    };
}

function buildShareSearch(opts) {
    const q = new URLSearchParams();
    if (opts.preset) q.set("preset", opts.preset);
    if (opts.app) q.set("app", String(opts.app));
    if (opts.net) q.set("net", opts.net);
    const s = q.toString();
    return s ? `?${s}` : "";
}

function syncShare(next) {
    try {
        const search = buildShareSearch(next);
        window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    } catch {
        /* ignore */
    }
}

async function algodGet(path) {
    const base = NETWORKS[state.network].algod;
    const res = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path} failed (${res.status}): ${text.slice(0, 240)}`);
    return JSON.parse(text);
}

async function getSdk() {
    if (state.sdk) return state.sdk;
    state.sdk = await import("algosdk");
    return state.sdk;
}

function encodeCallArgs(callArgs) {
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

function boxMbr(callArgs) {
    return BOX_MBR_FIXED + 400 * encodeCallArgs(callArgs).length;
}

function upkeepBoxName(id) {
    const name = new Uint8Array(9);
    name[0] = BOX_NAME_PREFIX.charCodeAt(0);
    new DataView(name.buffer).setBigUint64(1, BigInt(id));
    return name;
}

function nextUpkeepIdFromApp(app) {
    for (const entry of app.params["global-state"] ?? []) {
        const name = bytesToUtf8(b64ToBytes(entry.key));
        if (name === "next_upkeep_id") return BigInt(entry.value.uint ?? 0);
    }
    return 0n;
}

function registrationCost(opts) {
    const boxDeposit = boxMbr(opts.callArgs);
    const networkFees = opts.minFee * REGISTER_GROUP_SIZE;
    return {
        boxDeposit,
        escrow: opts.funding,
        networkFees,
        total: boxDeposit + opts.funding + networkFees,
    };
}

function parseAbiValue(algosdk, type, raw, structName, spec) {
    const value = String(raw ?? "").trim();
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
        if (!/^\d+$/.test(value || "0")) throw new Error(`Expected integer for ${type}`);
        return BigInt(value || "0");
    }
    if (type === "byte[][]") {
        const parsed = JSON.parse(value || "[]");
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
        const obj = JSON.parse(value || "{}");
        return spec.structs[structName].map((field) =>
            parseAbiValue(algosdk, field.type, String(obj[field.name] ?? ""), undefined, spec),
        );
    }
    if (value.startsWith("[") || value.startsWith("{")) return JSON.parse(value);
    return value;
}

function structTuple(spec, name) {
    const fields = spec.structs?.[name];
    if (!fields) throw new Error(`Unknown struct ${name}`);
    return `(${fields.map((f) => f.type).join(",")})`;
}

async function buildMethodCall(spec, method, values) {
    const algosdk = await getSdk();
    const abiMethod = new algosdk.ABIMethod({
        name: method.name,
        args: (method.args ?? []).map((a) => ({ name: a.name ?? "", type: a.type })),
        returns: { type: method.returns?.type ?? "void" },
    });
    const selector = abiMethod.getSelector();
    const encoded = [selector];
    for (const arg of method.args ?? []) {
        if (isTxnType(arg.type)) continue;
        const raw = values[arg.name ?? arg.type] ?? values[arg.name ?? ""] ?? "";
        const parsed = parseAbiValue(algosdk, arg.type, raw, arg.struct, spec);
        const type = algosdk.ABIType.from(arg.struct ? structTuple(spec, arg.struct) : arg.type);
        encoded.push(type.encode(parsed));
    }
    return { selector, encoded, signature: abiMethod.getSignature() };
}

function decodeAbiReturn(logs, type) {
    if (type === "void" || !logs.length) return undefined;
    const last = logs[logs.length - 1];
    const bytes = last instanceof Uint8Array ? last : b64ToBytes(typeof last === "string" ? last : "");
    const prefix = [0x15, 0x1f, 0x7c, 0x75];
    if (bytes.length < 4 || prefix.some((b, i) => bytes[i] !== b)) return undefined;
    const payload = bytes.slice(4);
    if (type === "string") return new TextDecoder().decode(payload);
    if (type.startsWith("uint") || type === "byte") {
        let n = 0n;
        for (const b of payload) n = (n << 8n) + BigInt(b);
        return n.toString();
    }
    if (type === "bool") return payload[payload.length - 1] ? "true" : "false";
    return `0x${bytesToHex(payload)}`;
}

const FALLBACK_WALLETS = [
    { id: "pera", name: "Pera", icon: null, connected: false, active: false, addresses: [] },
    { id: "defly", name: "Defly", icon: null, connected: false, active: false, addresses: [] },
    { id: "lute", name: "Lute", icon: null, connected: false, active: false, addresses: [] },
    { id: "exodus", name: "Exodus", icon: null, connected: false, active: false, addresses: [] },
    { id: "kibisis", name: "Kibisis", icon: null, connected: false, active: false, addresses: [] },
];

let walletManager = null;
let walletLoad = null;
let connectingId = null;
let walletsOpen = false;

function managerNetworks() {
    return {
        testnet: {
            algod: { token: "", baseServer: NETWORKS.testnet.algod, port: 443 },
            genesisId: "testnet-v1.0",
            isTestnet: true,
        },
        mainnet: {
            algod: { token: "", baseServer: NETWORKS.mainnet.algod, port: 443 },
            genesisId: "mainnet-v1.0",
        },
    };
}

function isDismissal(cause) {
    const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
    return (
        message.includes("closed") ||
        message.includes("cancel") ||
        message.includes("rejected") ||
        message.includes("declined")
    );
}

function snapshotWallets(m) {
    return m.wallets.map((wallet) => ({
        id: String(wallet.id),
        name: wallet.metadata?.name ?? String(wallet.id),
        icon: wallet.metadata?.icon ?? null,
        connected: wallet.isConnected,
        active: wallet.isActive,
        addresses: (wallet.accounts ?? []).map((account) => account.address),
    }));
}

function currentWallets() {
    return walletManager ? snapshotWallets(walletManager) : FALLBACK_WALLETS;
}

async function loadWalletManager() {
    if (walletManager) return walletManager;
    if (walletLoad) return walletLoad;
    walletLoad = (async () => {
        const [core, peraMod, deflyMod, luteMod, exodusMod, kibisisMod] = await Promise.all([
            import("@txnlab/use-wallet"),
            import("@txnlab/use-wallet-pera"),
            import("@txnlab/use-wallet-defly"),
            import("@txnlab/use-wallet-lute"),
            import("@txnlab/use-wallet-exodus"),
            import("@txnlab/use-wallet-kibisis"),
        ]);
        walletManager = new core.WalletManager({
            wallets: [peraMod.pera(), deflyMod.defly(), luteMod.lute(), exodusMod.exodus(), kibisisMod.kibisis()],
            networks: managerNetworks(),
            defaultNetwork: state.network,
            options: { persistNetwork: false },
        });
        walletManager.subscribe(() => {
            state.account = walletManager.activeAddress ?? null;
            renderWallet();
        });
        return walletManager;
    })();
    try {
        return await walletLoad;
    } catch (err) {
        walletLoad = null;
        throw err;
    }
}

async function connectWalletId(walletId) {
    const m = await loadWalletManager();
    if (m.activeNetwork !== state.network) await m.setActiveNetwork(state.network);
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

async function disconnectWallet() {
    if (!walletManager) return;
    try {
        await walletManager.disconnect();
    } catch {
        /* already gone */
    }
}

function setActiveWalletAccount(address) {
    walletManager?.activeWallet?.setActiveAccount(address);
}

function walletSigner() {
    if (!walletManager?.activeAddress) throw new Error("Wallet is not connected");
    return walletManager.transactionSigner;
}

function shortAddr(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function registerUpkeep(keeperAppId, params, nextId) {
    const algosdk = await getSdk();
    const client = new algosdk.Algodv2("", NETWORKS[state.network].algod, "");
    const suggestedParams = await client.getTransactionParams().do();
    const appAddress = algosdk.getApplicationAddress(keeperAppId);
    const composer = new algosdk.AtomicTransactionComposer();
    const signer = walletSigner();

    const payment = (amount, leg) => ({
        txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: state.account,
            receiver: appAddress,
            amount,
            suggestedParams,
            note: new TextEncoder().encode(`arcron:${leg}`),
        }),
        signer,
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
        sender: state.account,
        signer,
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

async function submitNoOpCall(appId, appArgs) {
    const algosdk = await getSdk();
    const client = new algosdk.Algodv2("", NETWORKS[state.network].algod, "");
    const suggestedParams = await client.getTransactionParams().do();
    const composer = new algosdk.AtomicTransactionComposer();
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: state.account,
        appIndex: appId,
        appArgs,
        suggestedParams,
    });
    composer.addTransaction({ txn, signer: walletSigner() });
    const result = await composer.execute(client, 8);
    return { txId: result.txIDs.at(-1) ?? "" };
}

function setError(msg) {
    const el = $("error");
    el.hidden = !msg;
    el.textContent = msg ?? "";
}

function setWalletError(msg) {
    const el = $("wallet-error");
    el.hidden = !msg;
    el.textContent = msg ?? "";
}

function setBusy(on) {
    $("busy").hidden = !on;
}

function el(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof children === "string") node.textContent = children;
    else if (Array.isArray(children)) children.forEach((c) => c && node.append(c));
    else if (children) node.append(children);
    return node;
}

function placeholderFor(type, struct) {
    if (struct) return `{ JSON for ${struct} }`;
    if (type === "address") return "ALGORANDADDRESS…";
    if (type.startsWith("uint") || type === "asset" || type === "application") return "0";
    if (type === "bool") return "true";
    if (type === "byte[][]") return '["0xabcd"]';
    if (type === "pay" || type === "axfer") return "amount in microAlgos";
    return type;
}

function renderWallet() {
    const btn = $("wallet-btn");
    const pop = $("wallet-pop");
    if (!btn || !pop) return;
    const wallets = currentWallets();
    const active = wallets.find((wallet) => wallet.active) ?? wallets.find((wallet) => wallet.connected);
    btn.replaceChildren();
    if (active?.icon) {
        const img = document.createElement("img");
        img.src = active.icon;
        img.alt = "";
        img.width = 18;
        img.height = 18;
        btn.append(img);
    }
    btn.append(el("span", "", connectingId ? "…" : state.account ? shortAddr(state.account) : "Connect"));
    btn.title = state.account ?? "Connect a wallet";
    btn.classList.toggle("connected", Boolean(state.account));
    btn.setAttribute("aria-expanded", walletsOpen ? "true" : "false");
    pop.hidden = !walletsOpen;
    if (!walletsOpen) {
        pop.replaceChildren();
        return;
    }
    pop.replaceChildren();
    if (state.account && active && active.addresses.length > 1) {
        for (const address of active.addresses) {
            const row = el(
                "button",
                "wallet-account" + (address === state.account ? " active" : ""),
                shortAddr(address),
            );
            row.type = "button";
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", address === state.account ? "true" : "false");
            row.addEventListener("click", () => {
                setActiveWalletAccount(address);
                state.account = address;
                renderWallet();
                renderMethods();
            });
            pop.append(row);
        }
    }
    for (const wallet of wallets) {
        const row = el("button", "wallet-choice" + (wallet.active ? " active" : ""));
        row.type = "button";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", wallet.active ? "true" : "false");
        row.disabled = connectingId !== null;
        if (wallet.icon) {
            const img = document.createElement("img");
            img.src = wallet.icon;
            img.alt = "";
            img.width = 18;
            img.height = 18;
            row.append(img);
        }
        row.append(el("span", "", connectingId === wallet.id ? "Waiting…" : wallet.name));
        row.addEventListener("click", () => void onConnectWallet(wallet.id));
        pop.append(row);
    }
    if (state.account) {
        const disc = el("button", "wallet-disconnect", "Disconnect");
        disc.type = "button";
        disc.addEventListener("click", () => void onDisconnect());
        pop.append(disc);
    }
}

function renderAppPanel() {
    const host = $("app-panel");
    host.replaceChildren();
    if (!state.app) {
        host.append(
            el("div", "card dashed", el("p", "lede", "Open Arcron Keeper to see a live TestNet registry, or load any app id you have a spec for.")),
        );
        return;
    }
    const card = el("div", "card");
    const head = el("div", "app-head");
    const titles = el("div");
    titles.append(el("p", "eyebrow", NETWORKS[state.network].label));
    titles.append(el("h2", "", state.spec?.name ?? `App ${state.app.id}`));
    const end = el("div", "app-head-end");
    const frozen = frozenFromState(state.global);
    if (frozen !== null) {
        end.append(el("span", "badge", frozen ? "frozen" : "unfrozen"));
    }
    const link = el("a", "", String(state.app.id));
    link.href = NETWORKS[state.network].explorerApp(state.app.id);
    link.target = "_blank";
    link.rel = "noreferrer";
    end.append(link);
    head.append(titles, end);
    card.append(head);
    if (state.spec?.desc) {
        card.append(el("p", "desc", String(state.spec.desc).split("\n")[0]));
    }
    const creator = state.app.params.creator ?? "";
    const schema = state.app.params["global-state-schema"] ?? {};
    const meta = el("dl", "meta");
    const row = (k, v) => {
        const d = el("div");
        d.append(el("dt", "", k), el("dd", "", v));
        meta.append(d);
    };
    row("Creator", creator ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : "—");
    row("Round", state.round?.toLocaleString() ?? "—");
    row("Global ints / bytes", `${schema["num-uint"] ?? 0} / ${schema["num-byte-slice"] ?? 0}`);
    row("Boxes", String(state.boxes.length));
    card.append(meta);
    card.append(el("h3", "", "Global state"));
    if (!state.global.length) {
        card.append(el("p", "lede", "None published."));
    } else {
        const list = el("ul", "state-list");
        for (const rowState of state.global) {
            const li = el("li");
            li.append(el("span", "k", rowState.label), el("span", "v", rowState.display));
            list.append(li);
        }
        card.append(list);
    }
    if (state.boxes.length) {
        card.append(el("h3", "", "Boxes"));
        const list = el("ul", "state-list");
        for (const box of state.boxes) {
            const li = el("li");
            li.style.display = "block";
            li.style.padding = "0";
            li.style.border = "none";
            const btn = el("button", "box-btn");
            btn.type = "button";
            const name = box.name ?? "";
            const shown = name.length > 18 ? `${name.slice(0, 18)}…` : name;
            btn.append(el("span", "name", shown), el("span", "open", "open"));
            btn.addEventListener("click", () => inspectBox(name));
            li.append(btn);
            list.append(li);
        }
        card.append(list);
        if (state.openBox) {
            card.append(el("pre", "box-value", state.openBox.value));
        }
    }
    host.append(card);
}

function renderMethods() {
    const host = $("methods");
    host.replaceChildren();
    if (!state.spec && !state.app) {
        const card = el("div", "card");
        card.append(el("h2", "", "Any contract. One page."));
        card.append(
            el(
                "p",
                "lede",
                "Arcui reads an ARC-56 spec and draws the forms. Readonly-shaped calls simulate against the live network. Zero-argument hooks pack into an Arcron upkeep you can sign from here.",
            ),
        );
        const ul = el("ul", "lede");
        ul.style.fontFamily = "var(--font-mono)";
        ul.style.fontSize = "12px";
        ul.style.color = "var(--text-faint)";
        ul.append(el("li", "", "ARC-4 ABI · ARC-32 / ARC-56 application spec"));
        ul.append(el("li", "", "Algod via AlgoNode · no indexer required"));
        ul.append(el("li", "", "Pera, Defly, Lute, Exodus, or Kibisis signs on a real origin"));
        card.append(ul);
        host.append(card);
        return;
    }
    if (!state.spec) {
        const card = el("div", "card");
        card.append(el("h2", "", "App loaded, no spec"));
        card.append(
            el("p", "lede", "Global state is on the left. Drop the ARC-56 JSON to generate method forms. Algorand does not store the ABI on chain."),
        );
        host.append(card);
        return;
    }
    const methods = state.spec.methods ?? [];
    if (state.draft && state.scheduleFor) host.append(renderSchedule());
    if (methods.length > 6) {
        const filter = el("input", "filter-methods");
        filter.type = "text";
        filter.placeholder = "Filter methods";
        filter.value = state.filter;
        filter.setAttribute("aria-label", "Filter methods");
        filter.addEventListener("input", () => {
            state.filter = filter.value;
            applyMethodFilter(host);
        });
        host.append(filter);
    }
    const q = state.filter.trim().toLowerCase();
    for (const method of methods) {
        const card = renderMethod(method);
        const hay = `${method.name} ${methodSignature(method)}`.toLowerCase();
        if (q && !hay.includes(q)) card.hidden = true;
        host.append(card);
    }
}

function applyMethodFilter(host) {
    const q = state.filter.trim().toLowerCase();
    host.querySelectorAll("[data-method]").forEach((card) => {
        const hay = `${card.dataset.method} ${card.dataset.sig}`.toLowerCase();
        card.hidden = Boolean(q) && !hay.includes(q);
    });
}

function renderMethod(method) {
    const card = el("article", "card method");
    card.dataset.method = method.name;
    card.dataset.sig = methodSignature(method);
    const head = el("div", "method-head");
    const titles = el("div", "");
    const titleRow = el("div", "method-title");
    titleRow.append(el("h3", "", method.name));
    titleRow.append(el("span", "badge", methodKind(method)));
    titles.append(titleRow);
    titles.append(el("p", "sig", methodSignature(method)));
    const copySel = el("button", "btn btn-selector", state.copiedSelector === method.name ? "copied" : "selector");
    copySel.type = "button";
    copySel.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(methodSignature(method));
            state.copiedSelector = method.name;
            copySel.textContent = "copied";
            setTimeout(() => {
                if (state.copiedSelector === method.name) {
                    state.copiedSelector = null;
                    copySel.textContent = "selector";
                }
            }, 1200);
        } catch {
            setError("Could not copy selector");
        }
    });
    head.append(titles, copySel);
    card.append(head);
    if (method.desc) {
        card.append(el("p", "desc", String(method.desc).split("\n").slice(0, 4).join("\n")));
    }
    const args = method.args ?? [];
    if (!args.length) {
        card.append(el("p", "sig", "No arguments. Selector only."));
    } else {
        for (const arg of args) {
            const name = arg.name ?? arg.type;
            const field = el("label", "field");
            const top = el("span", "lbl");
            const nameSpan = document.createElement("span");
            nameSpan.textContent = name;
            const typeSpan = el("span", "type", ` : ${arg.type}`);
            top.append(nameSpan, typeSpan);
            if (isTxnType(arg.type)) {
                top.append(el("span", "warn", " group txn"));
            }
            field.append(top);
            const input = el("input");
            input.type = "text";
            input.placeholder = placeholderFor(arg.type, arg.struct);
            const stored = valuesFor(method)[name];
            input.value = stored ?? "";
            input.addEventListener("input", () => {
                state.values[method.name] ??= {};
                state.values[method.name][name] = input.value;
            });
            field.append(input);
            if (arg.desc) field.append(el("span", "sig", arg.desc));
            card.append(field);
        }
    }
    const actions = el("div", "actions");
    const busy = state.calling === method.name;
    const sim = el("button", "btn btn-ink", txnArgs(method).length ? "Simulate (limited)" : "Simulate");
    sim.type = "button";
    sim.disabled = busy;
    sim.addEventListener("click", () => runMethod(method, false));
    actions.append(sim);
    if (state.account && txnArgs(method).length === 0) {
        const call = el("button", "btn", "Call");
        call.type = "button";
        call.disabled = busy;
        call.addEventListener("click", () => runMethod(method, true));
        actions.append(call);
    }
    if (isSchedulable(method)) {
        const sched = el("button", "btn" + (state.scheduleFor === method.name ? " active" : ""), "Schedule on Arcron");
        sched.type = "button";
        sched.addEventListener("click", () => makeDraft(method));
        actions.append(sched);
    }
    card.append(actions);
    const result = state.results[method.name];
    if (result) {
        card.append(el("pre", `result ${result.ok ? "ok" : "fail"}`, result.message));
    }
    return card;
}

function renderSchedule() {
    const draft = state.draft;
    const card = el("aside", "card accent");
    card.append(el("p", "eyebrow", "Arcron upkeep"));
    card.append(el("h2", "", `${draft.method} every ${draft.intervalLabel}`));
    card.append(el("p", "lede", draft.note));
    const grid = el("div", "grid-3");
    const cadence = el("label", "field");
    cadence.append(el("span", "lbl", "Cadence"));
    const sel = el("select");
    for (const row of INTERVALS) {
        const opt = el("option", "", `${row.label} · ${row.rounds} rounds`);
        opt.value = String(row.rounds);
        if (row.rounds === state.interval) opt.selected = true;
        sel.append(opt);
    }
    sel.addEventListener("change", () => {
        state.interval = Number(sel.value);
        const method = state.spec.methods.find((m) => m.name === state.scheduleFor);
        if (method) makeDraft(method);
    });
    cadence.append(sel);
    const fee = el("label", "field");
    fee.append(el("span", "lbl", "Fee (ALGO)"));
    const feeIn = el("input");
    feeIn.value = state.feeAlgo;
    feeIn.addEventListener("input", () => {
        state.feeAlgo = feeIn.value;
    });
    feeIn.addEventListener("blur", () => {
        const method = state.spec.methods.find((m) => m.name === state.scheduleFor);
        if (method) makeDraft(method);
    });
    fee.append(feeIn);
    const pol = el("label", "field");
    pol.append(el("span", "lbl", "Policy"));
    const polSel = el("select");
    polSel.append(Object.assign(el("option", "", "SKIP_AHEAD (1)"), { value: "1" }));
    polSel.append(Object.assign(el("option", "", "CATCH_UP (0)"), { value: "0" }));
    polSel.value = String(state.policy);
    polSel.addEventListener("change", () => {
        state.policy = Number(polSel.value);
        const method = state.spec.methods.find((m) => m.name === state.scheduleFor);
        if (method) makeDraft(method);
    });
    pol.append(polSel);
    grid.append(cadence, fee, pol);
    card.append(grid);
    const kv = el("dl", "kv");
    const add = (k, v) => {
        const d = el("div");
        d.append(el("dt", "", k), el("dd", "", v));
        kv.append(d);
    };
    add("keeper app", String(draft.keeperAppId));
    add("target", String(draft.targetApp));
    add("fee", `${draft.feeMicro} µALGO`);
    add("box deposit", `${draft.boxDeposit} µALGO`);
    add("escrow", `${draft.funding} µALGO · ${draft.executions} runs`);
    add("call_args", draft.callArgsHex.join(" · "));
    card.append(kv);
    const actions = el("div", "actions");
    const sign = el(
        "button",
        "btn btn-ink",
        state.registerBusy ? "Signing…" : state.account ? "Sign & register" : "Connect a wallet to register",
    );
    sign.type = "button";
    sign.disabled = state.registerBusy || !state.account;
    sign.addEventListener("click", () => signRegister());
    const copy = el("button", "btn", "Copy payload");
    copy.type = "button";
    copy.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
            copy.textContent = "Copied";
            setTimeout(() => {
                copy.textContent = "Copy payload";
            }, 1600);
        } catch {
            setError("Could not copy payload");
        }
    });
    const open = el("a", "btn", "Open console");
    open.href = draft.consoleUrl;
    open.target = "_blank";
    open.rel = "noreferrer";
    actions.append(sign, copy, open);
    card.append(actions);
    if (state.registerResult) {
        const ok = /registered|submitted/i.test(state.registerResult);
        card.append(el("pre", `result ${ok ? "ok" : "fail"}`, state.registerResult));
    }
    return card;
}

async function inspectBox(nameB64) {
    if (!state.app) return;
    try {
        const box = await algodGet(
            `/v2/applications/${state.app.id}/box?name=b64:${encodeURIComponent(nameB64)}`,
        );
        state.openBox = box;
        renderAppPanel();
    } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read box");
    }
}

async function applyLoaded(spec, info, status, boxes, presetId = "", seed = false) {
    state.spec = spec;
    state.app = info;
    state.round = status["last-round"];
    state.boxes = boxes ?? [];
    state.openBox = null;
    state.global = decodeGlobalState(info.params["global-state"] ?? [], spec);
    state.draft = null;
    state.scheduleFor = null;
    state.registerResult = null;
    state.results = {};
    state.activePreset = presetId;
    if (spec && seed) seedValues(spec);
    renderAppPanel();
    renderMethods();
}

async function loadPreset(id) {
    const preset = PRESETS[id];
    if (!preset) return;
    document.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.preset === id);
    });
    state.network = preset.network;
    $("network").value = preset.network;
    $("app-id").value = String(preset.appId);
    setBusy(true);
    setError("");
    try {
        const res = await fetch(preset.specUrl);
        if (!res.ok) throw new Error(`Could not load ${preset.label} spec`);
        const spec = parseSpec(await res.json());
        const [info, status, boxList] = await Promise.all([
            algodGet(`/v2/applications/${preset.appId}`),
            algodGet("/v2/status"),
            algodGet(`/v2/applications/${preset.appId}/boxes?max=64`).catch(() => ({ boxes: [] })),
        ]);
        await applyLoaded(spec, info, status, boxList.boxes ?? [], id, true);
        syncShare({ preset: id, net: preset.network });
    } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preset");
    } finally {
        setBusy(false);
    }
}

async function loadApp() {
    const id = Number($("app-id").value.trim());
    if (!Number.isInteger(id) || id <= 0) {
        setError("App id must be a positive integer");
        return;
    }
    document.querySelectorAll("[data-preset]").forEach((btn) => btn.classList.remove("active"));
    state.activePreset = "";
    setBusy(true);
    setError("");
    try {
        let spec = state.spec;
        const pasted = $("spec-text").value.trim();
        if (pasted) spec = parseSpec(JSON.parse(pasted));
        const [info, status, boxList] = await Promise.all([
            algodGet(`/v2/applications/${id}`),
            algodGet("/v2/status"),
            algodGet(`/v2/applications/${id}/boxes?max=64`).catch(() => ({ boxes: [] })),
        ]);
        await applyLoaded(spec, info, status, boxList.boxes ?? [], "");
        syncShare({ app: id, net: state.network });
    } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load application");
    } finally {
        setBusy(false);
    }
}

async function runMethod(method, signed) {
    if (!state.spec || !state.app) return;
    if (!signed && txnArgs(method).length) {
        state.results[method.name] = {
            ok: false,
            message:
                "This method needs a payment or asset transfer in the group. Simulate without a wallet is limited to methods that take no transactions.",
        };
        renderMethods();
        return;
    }
    state.calling = method.name;
    renderMethods();
    try {
        if (signed) {
            if (!state.account) throw new Error("Connect a wallet first");
            const built = await buildMethodCall(state.spec, method, valuesFor(method));
            const result = await submitNoOpCall(state.app.id, built.encoded);
            state.results[method.name] = { ok: true, message: `submitted ${result.txId}` };
        } else {
            const built = await buildMethodCall(state.spec, method, valuesFor(method));
            const algosdk = await getSdk();
            const client = new algosdk.Algodv2("", NETWORKS[state.network].algod, "");
            const sp = await client.getTransactionParams().do();
            const dummy = algosdk.generateAccount();
            const from = state.account ?? dummy.addr;
            const txn = algosdk.makeApplicationNoOpTxnFromObject({
                sender: from,
                appIndex: state.app.id,
                appArgs: built.encoded,
                suggestedParams: { ...sp, flatFee: true, fee: state.account ? sp.minFee ?? 1000n : 0n },
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
            const decoded = decodeAbiReturn(logs, method.returns?.type ?? "void");
            const fail = group?.failureMessage ?? "";
            const feeOnly = /overspend|fees is less than|min fee|fee too (small|low)/i.test(fail);
            if (fail && !feeOnly) {
                state.results[method.name] = { ok: false, message: fail };
            } else {
                state.results[method.name] = { ok: true, message: decoded ? `returned ${decoded}` : "succeeded (no return)" };
            }
        }
    } catch (err) {
        state.results[method.name] = { ok: false, message: err instanceof Error ? err.message : "Call failed" };
    } finally {
        state.calling = null;
        renderMethods();
    }
}

async function makeDraft(method) {
    if (!state.spec || !state.app) return;
    try {
        const built = await buildMethodCall(state.spec, method, valuesFor(method));
        const interval = INTERVALS.find((i) => i.rounds === state.interval);
        const feeMicro = Math.max(MIN_UPKEEP_FEE, Math.round((Number(state.feeAlgo) || 0.01) * 1_000_000));
        const funding = feeMicro * EXECUTIONS;
        const cost = registrationCost({ callArgs: built.encoded, funding, minFee: 1000 });
        state.scheduleFor = method.name;
        state.registerResult = null;
        state.draft = {
            targetApp: state.app.id,
            method: method.name,
            signature: methodSignature(method),
            callArgsHex: built.encoded.map(hexOf),
            intervalRounds: state.interval,
            intervalLabel: interval?.label ?? `${state.interval} rounds`,
            feeMicro,
            policy: state.policy,
            policyLabel: state.policy === ARCRON.skipAhead ? "SKIP_AHEAD" : "CATCH_UP",
            feeCap: 0,
            keeperAppId: ARCRON.testnetAppId,
            consoleUrl: ARCRON.console,
            note: "call_args is frozen at register. A keeper decides when this runs, never what it says. Policy 1 (SKIP_AHEAD) is the default you should mean.",
            boxDeposit: boxMbr(built.encoded),
            funding,
            executions: EXECUTIONS,
            totalMicro: cost.total,
        };
        renderMethods();
    } catch (err) {
        setError(err instanceof Error ? err.message : "Could not draft the upkeep");
    }
}

async function signRegister() {
    if (!state.draft || !state.app) return;
    if (!state.account) {
        setWalletError("Connect a wallet to sign register");
        return;
    }
    if (state.network !== "testnet") {
        state.registerResult = "Arcron Keeper is TestNet-only for now.";
        renderMethods();
        return;
    }
    state.registerBusy = true;
    state.registerResult = null;
    renderMethods();
    try {
        const method = state.spec?.methods.find((m) => m.name === state.draft.method);
        if (!state.spec || !method) throw new Error("Spec lost the method");
        const built = await buildMethodCall(state.spec, method, valuesFor(method));
        const keeper = await algodGet(`/v2/applications/${ARCRON.testnetAppId}`);
        const nextId = nextUpkeepIdFromApp(keeper);
        const result = await registerUpkeep(
            ARCRON.testnetAppId,
            {
                targetApp: state.draft.targetApp,
                callArgs: built.encoded,
                intervalRounds: state.draft.intervalRounds,
                feePerExecution: state.draft.feeMicro,
                funding: state.draft.funding,
                policy: state.draft.policy,
                feeCap: 0,
                feeAsset: 0,
                assetFee: 0,
            },
            nextId,
        );
        state.registerResult = result.returnValue
            ? `Registered upkeep ${result.returnValue} · ${result.txId}`
            : `Submitted ${result.txId}`;
    } catch (err) {
        state.registerResult = err instanceof Error ? err.message : "Register failed";
    } finally {
        state.registerBusy = false;
        renderMethods();
    }
}

async function onConnectWallet(walletId) {
    connectingId = walletId;
    setWalletError("");
    renderWallet();
    try {
        const address = await connectWalletId(walletId);
        state.account = address;
        walletsOpen = false;
    } catch (err) {
        if (!isDismissal(err)) {
            setWalletError(err instanceof Error ? err.message : "Could not connect");
        }
    } finally {
        if (connectingId === walletId) connectingId = null;
        renderWallet();
        renderMethods();
    }
}

async function onDisconnect() {
    try {
        await disconnectWallet();
    } catch {
        /* already gone */
    }
    state.account = null;
    walletsOpen = false;
    renderWallet();
    renderMethods();
}

async function bootWallet() {
    try {
        const m = await loadWalletManager();
        await m.resumeSessions();
        if (m.activeNetwork !== state.network) await m.setActiveNetwork(state.network);
        state.account = m.activeAddress ?? null;
        renderWallet();
        renderMethods();
    } catch {
        /* no session, or wallets unavailable — page stays usable */
    }
}

function honorShareQuery() {
    const q = parseShareQuery(window.location.search);
    if (q.preset && PRESETS[q.preset]) {
        void loadPreset(q.preset);
        return;
    }
    if (q.app) {
        $("app-id").value = q.app;
        if (q.net) {
            state.network = q.net;
            $("network").value = q.net;
        }
        void loadApp();
        return;
    }
    void loadPreset("keeper");
}

function wire() {
    $("network").addEventListener("change", (e) => {
        state.network = e.target.value;
        if (state.account) void onDisconnect();
    });
    $("load-app").addEventListener("click", () => loadApp());
    $("pick-spec").addEventListener("click", () => $("spec-file").click());
    $("spec-file").addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result ?? "");
            $("spec-text").value = text;
            try {
                state.spec = parseSpec(JSON.parse(text));
                seedValues(state.spec);
                setError("");
                renderMethods();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Invalid ARC-56 JSON");
            }
        };
        reader.readAsText(file);
    });
    document.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.addEventListener("click", () => loadPreset(btn.dataset.preset));
    });
    $("wallet-btn").addEventListener("click", (ev) => {
        ev.stopPropagation();
        walletsOpen = !walletsOpen;
        renderWallet();
        if (walletsOpen && !walletManager) {
            void loadWalletManager()
                .then(() => renderWallet())
                .catch((err) => {
                    setWalletError(err instanceof Error ? err.message : "Wallets failed to load");
                });
        }
    });
    document.addEventListener("mousedown", (ev) => {
        const menu = $("wallet-menu");
        if (!walletsOpen || !menu || menu.contains(ev.target)) return;
        walletsOpen = false;
        renderWallet();
    });
    $("copy-link").addEventListener("click", async () => {
        try {
            const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
            await navigator.clipboard.writeText(url);
            const note = $("share-copied");
            note.hidden = false;
            setTimeout(() => {
                note.hidden = true;
            }, 1600);
        } catch {
            setError("Could not copy link");
        }
    });
    renderWallet();
    renderAppPanel();
    renderMethods();
    honorShareQuery();
    void bootWallet();
    try {
        if (window.self !== window.top) $("embed-note").hidden = false;
    } catch {
        $("embed-note").hidden = false;
    }
}

wire();
