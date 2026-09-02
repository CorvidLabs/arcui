---
module: wallets
version: 1
status: active
files:
  - src/lib/wallet.ts
db_tables: []
depends_on: []
---

# wallets

## Purpose

Connect any of the self-contained Algorand wallets Arcron already offers, through `@txnlab/use-wallet`. The workbench never talks to a specific wallet SDK. It asks the manager for `{ sender, signer }`.

## Public API

| Name | Kind | Description |
|------|------|-------------|
| `WalletOption` | type | `{ id, name, icon, connected, active, addresses }` for the picker. |
| `isEmbeddedPreview` | function | True when `window.self !== window.top`. Signing is refused in an iframe. |
| `publicWallets` | function | `[pera(), defly(), lute(), exodus(), kibisis()]`. No WalletConnect unless a project id is added later. |
| `managerNetworks` | function | TestNet and MainNet algod config in the shape `WalletManager` expects. |
| `isDismissal` | function | True when the wallet modal was closed or the request declined. |
| `snapshotWallets` | function | Map `manager.wallets` to `WalletOption[]`. |
| `getWalletManager` | function | Lazy singleton `WalletManager` for the browser. Throws off-window. |
| `ensureWalletNetwork` | function | `setActiveNetwork` when the manager's network disagrees with the page. |
| `resumeWallet` | function | Restore a previous session; `null` if none. |
| `connectWalletId` | function | Connect one wallet, disconnect the others, return the active address. |
| `disconnectWallet` | function | Disconnect the active wallet. |
| `setActiveWalletAccount` | function | Switch between accounts on the connected wallet. |
| `walletSigner` | function | `manager.transactionSigner`. Throws if nothing is connected. |
| `activeWalletAddress` | function | Current address, or `null`. |

## Invariants

1. The catalogue is Pera, Defly, Lute, Exodus, Kibisis, in that order. None of them needs a WalletConnect project id. KMD is omitted: Arcui has no LocalNet.
2. One active wallet at a time. Connecting a second wallet disconnects the first, so "the connected account" is never ambiguous when a group is signed.
3. Closing or declining a wallet modal is not an error. `isDismissal` is how the workbench decides to stay quiet.
4. The manager is a browser singleton. SSR must not construct it. `getWalletManager` throws when `window` is missing.
5. `walletSigner` is the only signer the register path uses. Packing stays in `register.ts`.

## Behavioral Examples

### Scenario: Catalogue needs no configuration

- **Given** a fresh page with no WalletConnect project id
- **When** `publicWallets()` runs
- **Then** the ids are `pera`, `defly`, `lute`, `exodus`, `kibisis`

### Scenario: Connect Defly while Pera is active

- **Given** Pera is connected
- **When** `connectWalletId` is called with `defly`
- **Then** Pera is disconnected first, Defly becomes the active wallet, and the returned address is Defly's

### Scenario: User closes the wallet modal

- **Given** a connect attempt
- **When** the adapter throws `Connect cancelled` or similar
- **Then** `isDismissal` is true and the workbench does not paint an error

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `getWalletManager` off-window | Throws `Wallets only exist in the browser` |
| Unknown `walletId` | Throws `Unknown wallet: …` |
| Adapter returns no account | Throws `Wallet returned no account` |
| `walletSigner` with no session | Throws `Wallet is not connected` |
| Modal closed / request declined | Treated as dismissal, not an error |

## Dependencies

### Consumes

| Module | What is used |
|--------|-------------|
| `networks` | `NETWORKS[id].algod` as `baseServer` |
| `@txnlab/use-wallet` | `WalletManager` |
| `@txnlab/use-wallet-pera` | `pera()` |
| `@txnlab/use-wallet-defly` | `defly()` |
| `@txnlab/use-wallet-lute` | `lute()` |
| `@txnlab/use-wallet-exodus` | `exodus()` |
| `@txnlab/use-wallet-kibisis` | `kibisis()` |

### Consumed By

| Module | What is used |
|--------|-------------|
| workbench | picker, `walletSigner` for `register` and signed NoOp |

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-09-02 | CorvidLabs | Replace Pera-only `@perawallet/connect` with TxnLab `use-wallet` v5. |
