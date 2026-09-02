import type { NetworkId } from "./networks";

export type ShareQuery = {
  preset: string | null;
  app: string | null;
  net: NetworkId | null;
};

export function parseShareQuery(search: string): ShareQuery {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const net = q.get("net");
  return {
    preset: q.get("preset"),
    app: q.get("app"),
    net: net === "mainnet" || net === "testnet" ? net : null,
  };
}

export function buildShareSearch(opts: { preset?: string; app?: number | string; net?: NetworkId }) {
  const q = new URLSearchParams();
  if (opts.preset) q.set("preset", opts.preset);
  if (opts.app) q.set("app", String(opts.app));
  if (opts.net) q.set("net", opts.net);
  const s = q.toString();
  return s ? `?${s}` : "";
}
