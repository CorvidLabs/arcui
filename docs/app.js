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

const ALGOSDK_URL = "https://esm.sh/algosdk@3.7.0";

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
    round: null,
    values: {},
    interval: INTERVALS[2].rounds,
    feeAlgo: "0.01",
    policy: ARCRON.skipAhead,
    draft: null,
    scheduleFor: null,
    sdk: null,
};

function isTxnType(type) {
    return TXN_TYPES.has(type);
}

function abiArgs(method) {
    return method.args.filter((a) => !isTxnType(a.type));
}

function txnArgs(method) {
    return method.args.filter((a) => isTxnType(a.type));
}

function isSchedulable(method) {
    if (method.readonly) return false;
    if (txnArgs(method).length > 0) return false;
    return abiArgs(method).length <= 2;
}

function methodSignature(method) {
    const args = (method.args ?? []).map((a) => a.type).join(",");
    const ret = method.returns?.type ?? "void";
    return `${method.name}(${args})${ret}`;
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
            return { key: keyName, label, display: String(entry.value.uint ?? 0) };
        }
        const raw = entry.value.bytes ?? "";
        const valBytes = raw ? b64ToBytes(raw) : new Uint8Array();
        const text = bytesToUtf8(valBytes);
        const display = /^[\x20-\x7e]*$/.test(text) && text.length > 0 ? text : `0x${bytesToHex(valBytes)}`;
        return { key: keyName, label, display };
    });
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
    state.sdk = await import(ALGOSDK_URL);
    return state.sdk;
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
        const raw = values[arg.name ?? ""] ?? "";
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

function setError(msg) {
    const el = $("error");
    el.hidden = !msg;
    el.textContent = msg ?? "";
}

function setBusy(on) {
    $("busy").hidden = !on;
}

function text(el, value) {
    el.textContent = value ?? "";
    return el;
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
    const link = el("a", "", String(state.app.id));
    link.href = NETWORKS[state.network].explorerApp(state.app.id);
    link.target = "_blank";
    link.rel = "noreferrer";
    head.append(titles, link);
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
                "Arcui reads an ARC-56 spec and draws the forms. Readonly-shaped calls simulate against the live network. Zero-argument hooks can be packed into an Arcron upkeep without writing a console.",
            ),
        );
        const ul = el("ul", "lede");
        ul.style.fontFamily = "var(--font-mono)";
        ul.style.fontSize = "12px";
        ul.style.color = "var(--text-faint)";
        ul.append(el("li", "", "ARC-4 ABI · ARC-32 / ARC-56 application spec"));
        ul.append(el("li", "", "Algod via AlgoNode · no indexer required"));
        ul.append(el("li", "", "Signing a write still needs a wallet on a real origin"));
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
    for (const method of state.spec.methods) {
        host.append(renderMethod(method));
    }
    if (state.draft && state.scheduleFor) host.append(renderSchedule());
}

function renderMethod(method) {
    const card = el("article", "card method");
    const title = el("h3", "");
    title.append(method.name);
    if (method.readonly) title.append(el("span", "badge", "readonly"));
    card.append(title);
    card.append(el("p", "sig", methodSignature(method)));
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
            top.append(`${name} : ${arg.type}`);
            if (isTxnType(arg.type)) {
                const w = el("span", "warn", " group txn");
                top.append(w);
            }
            field.append(top);
            const input = el("input");
            input.type = "text";
            input.placeholder = placeholderFor(arg.type, arg.struct);
            input.value = state.values[method.name]?.[name] ?? "";
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
    const sim = el("button", "btn btn-ink", txnArgs(method).length ? "Simulate (limited)" : "Simulate");
    sim.type = "button";
    sim.addEventListener("click", () => runMethod(method, sim, card));
    actions.append(sim);
    if (isSchedulable(method)) {
        const sched = el("button", "btn" + (state.scheduleFor === method.name ? " active" : ""), "Schedule on Arcron");
        sched.type = "button";
        sched.addEventListener("click", () => makeDraft(method));
        actions.append(sched);
    }
    card.append(actions);
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
    });
    cadence.append(sel);
    const fee = el("label", "field");
    fee.append(el("span", "lbl", "Fee (ALGO)"));
    const feeIn = el("input");
    feeIn.value = state.feeAlgo;
    feeIn.addEventListener("input", () => {
        state.feeAlgo = feeIn.value;
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
    });
    pol.append(polSel);
    grid.append(cadence, fee, pol);
    card.append(grid);
    const recalc = el("button", "btn", "Recalculate");
    recalc.type = "button";
    recalc.style.marginTop = "12px";
    recalc.addEventListener("click", () => {
        const method = state.spec.methods.find((m) => m.name === state.scheduleFor);
        if (method) makeDraft(method);
    });
    card.append(recalc);
    const kv = el("dl", "kv");
    const add = (k, v) => {
        const d = el("div");
        d.append(el("dt", "", k), el("dd", "", v));
        kv.append(d);
    };
    add("keeper app", String(draft.keeperAppId));
    add("target", String(draft.targetApp));
    add("fee", `${draft.feeMicro} µALGO`);
    add("call_args", draft.callArgsHex.join(" · "));
    card.append(kv);
    const actions = el("div", "actions");
    const copy = el("button", "btn btn-ink", "Copy register payload");
    copy.type = "button";
    copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
        copy.textContent = "Copied";
        setTimeout(() => {
            copy.textContent = "Copy register payload";
        }, 1600);
    });
    const open = el("a", "btn", "Open Arcron console");
    open.href = draft.consoleUrl;
    open.target = "_blank";
    open.rel = "noreferrer";
    actions.append(copy, open);
    card.append(actions);
    card.append(
        el(
            "p",
            "sig",
            "Submitting register still needs a wallet. This page packs the call; the console at corvidlabs.xyz is the signing surface until Arcui grows one.",
        ),
    );
    return card;
}

async function applyLoaded(spec, info, status, boxes) {
    state.spec = spec;
    state.app = info;
    state.round = status["last-round"];
    state.boxes = boxes ?? [];
    state.global = decodeGlobalState(info.params["global-state"] ?? [], spec);
    state.draft = null;
    state.scheduleFor = null;
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
        await applyLoaded(spec, info, status, boxList.boxes ?? []);
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
        await applyLoaded(spec, info, status, boxList.boxes ?? []);
    } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load application");
    } finally {
        setBusy(false);
    }
}

async function runMethod(method, button, card) {
    if (!state.spec || !state.app) return;
    if (txnArgs(method).length) {
        showResult(card, false, "This method needs a payment or asset transfer in the group. Simulate without a wallet is limited to methods that take no transactions.");
        return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Simulating…";
    try {
        const built = await buildMethodCall(state.spec, method, state.values[method.name] ?? {});
        const algosdk = await getSdk();
        const client = new algosdk.Algodv2("", NETWORKS[state.network].algod, "");
        const sp = await client.getTransactionParams().do();
        const dummy = algosdk.generateAccount();
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: dummy.addr,
            appIndex: state.app.id,
            appArgs: built.encoded,
            suggestedParams: { ...sp, flatFee: true, fee: sp.minFee ?? 1000n },
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
        if (group?.failureMessage) {
            showResult(card, false, group.failureMessage);
        } else {
            showResult(card, true, decoded ? `returned ${decoded}` : "succeeded (no return)");
        }
    } catch (err) {
        showResult(card, false, err instanceof Error ? err.message : "Call failed");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

function showResult(card, ok, message) {
    card.querySelector(".result")?.remove();
    const pre = el("pre", `result ${ok ? "ok" : "fail"}`, message);
    card.append(pre);
}

async function makeDraft(method) {
    if (!state.spec || !state.app) return;
    setBusy(true);
    try {
        const built = await buildMethodCall(state.spec, method, state.values[method.name] ?? {});
        const interval = INTERVALS.find((i) => i.rounds === state.interval);
        const feeMicro = Math.max(ARCRON.minFeeMicro, Math.round((Number(state.feeAlgo) || 0.01) * 1_000_000));
        state.scheduleFor = method.name;
        state.draft = {
            targetApp: state.app.id,
            method: method.name,
            signature: methodSignature(method),
            callArgsHex: built.encoded.map((b) => `0x${bytesToHex(b)}`),
            intervalRounds: state.interval,
            intervalLabel: interval?.label ?? `${state.interval} rounds`,
            feeMicro,
            policy: state.policy,
            policyLabel: state.policy === ARCRON.skipAhead ? "SKIP_AHEAD" : "CATCH_UP",
            feeCap: 0,
            keeperAppId: ARCRON.testnetAppId,
            consoleUrl: ARCRON.console,
            note: "call_args is frozen at register. A keeper decides when this runs, never what it says. Policy 1 (SKIP_AHEAD) is the default you should mean.",
        };
        renderMethods();
    } catch (err) {
        setError(err instanceof Error ? err.message : "Could not draft the upkeep");
    } finally {
        setBusy(false);
    }
}

function wire() {
    $("network").addEventListener("change", (e) => {
        state.network = e.target.value;
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
    renderAppPanel();
    renderMethods();
    void loadPreset("keeper");
}

wire();
