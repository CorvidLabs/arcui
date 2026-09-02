export type NetworkId = "mainnet" | "testnet";

export type Network = {
  id: NetworkId;
  label: string;
  algod: string;
  explorerApp: (id: number) => string;
  explorerAccount: (addr: string) => string;
};

export const NETWORKS: Record<NetworkId, Network> = {
  testnet: {
    id: "testnet",
    label: "TestNet",
    algod: "https://testnet-api.algonode.cloud",
    explorerApp: (id) => `https://testnet.explorer.perawallet.app/application/${id}`,
    explorerAccount: (addr) => `https://testnet.explorer.perawallet.app/address/${addr}`,
  },
  mainnet: {
    id: "mainnet",
    label: "MainNet",
    algod: "https://mainnet-api.algonode.cloud",
    explorerApp: (id) => `https://explorer.perawallet.app/application/${id}`,
    explorerAccount: (addr) => `https://explorer.perawallet.app/address/${addr}`,
  },
};

export const ARCRON = {
  testnetAppId: 769891898,
  testnetPulseId: 769891902,
  testnetAppAddress: "M4YFP33L5VIFRF53X53WUMQWBOWSLYQNBSSAJV2SORGF43L36XBY7OREUA",
  console: "https://corvidlabs.xyz/arcron/console/",
  minFeeMicro: 4000,
  minIntervalRounds: 10,
  skipAhead: 1,
  catchUp: 0,
  roundSeconds: { testnet: 2.695, mainnet: 2.752 },
};

export const ZERO_ADDR = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
