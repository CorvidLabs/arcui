import { NETWORKS, type NetworkId } from "./networks";

export type AlgodApp = {
  id: number;
  params: {
    creator: string;
    "approval-program"?: string;
    "clear-state-program"?: string;
    "global-state"?: { key: string; value: { type: number; uint?: number; bytes?: string } }[];
    "global-state-schema"?: { "num-uint": number; "num-byte-slice": number };
    "local-state-schema"?: { "num-uint": number; "num-byte-slice": number };
  };
};

async function call(network: NetworkId, method: "GET" | "POST", path: string, body?: unknown) {
  const base = NETWORKS[network].algod;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function parseJson<T>(result: { ok: boolean; status: number; text: string }, label: string): T {
  const body = typeof result.text === "string" ? result.text : JSON.stringify(result.text ?? "");
  if (!result.ok) {
    throw new Error(`${label} failed (${result.status}): ${body.slice(0, 280)}`);
  }
  return JSON.parse(body) as T;
}

export async function getStatus(network: NetworkId) {
  return parseJson<{ "last-round": number }>(await call(network, "GET", "/v2/status"), "status");
}

export async function getApplication(network: NetworkId, appId: number) {
  return parseJson<AlgodApp>(
    await call(network, "GET", `/v2/applications/${appId}`),
    `application ${appId}`,
  );
}

export async function getSuggestedParams(network: NetworkId) {
  return parseJson<{
    "min-fee": number;
    "genesis-hash": string;
    "genesis-id": string;
    "last-round": number;
    "consensus-version": string;
  }>(await call(network, "GET", "/v2/transactions/params"), "params");
}

export async function listBoxes(network: NetworkId, appId: number) {
  const data = parseJson<{ boxes?: { name: string }[] }>(
    await call(network, "GET", `/v2/applications/${appId}/boxes?max=64`),
    "boxes",
  );
  return data.boxes ?? [];
}

export async function getBox(network: NetworkId, appId: number, nameB64: string) {
  return parseJson<{ name: string; value: string }>(
    await call(network, "GET", `/v2/applications/${appId}/box?name=b64:${encodeURIComponent(nameB64)}`),
    "box",
  );
}

export async function simulate(network: NetworkId, body: unknown) {
  return parseJson<Record<string, unknown>>(
    await call(network, "POST", "/v2/transactions/simulate", body),
    "simulate",
  );
}

export async function getAccount(network: NetworkId, addr: string) {
  return parseJson<{
    amount: number;
    "apps-total-schema"?: unknown;
    "created-apps"?: { id: number }[];
  }>(await call(network, "GET", `/v2/accounts/${addr}`), "account");
}
