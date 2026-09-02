# Arcui

Generated frontend for any Algorand smart contract.

**Live: [corvidlabs.github.io/arcui](https://corvidlabs.github.io/arcui/)**

Paste an app id, drop an [ARC-56](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0056.md) spec, and Arcui draws the method forms. Live TestNet presets for [Arcron](https://github.com/CorvidLabs/arcron) Keeper and Pulse ship with the page so there is something real to click on day one.

This is a workbench, not another Arcron console. Any contract with an ARC-56 (or legacy ARC-32) spec is in scope.

The page talks to [AlgoNode](https://algonode.io) algod from the browser. No indexer. No backend. GitHub Pages serves the static files in `docs/`.

## What v1 does

- Load any app id on TestNet or MainNet and decode global state against the spec
- Generate a form per ABI method
- Simulate calls that do not need a group payment (empty-signature simulate, unnamed resources allowed)
- Connect Pera, Defly, Lute, Exodus, or Kibisis and sign `register` on the live TestNet Keeper
- Pack a **Schedule on Arcron** payload for hooks with no group transactions and at most two ABI args. Admin methods (`update` / `freeze` / `UpdateApplication`) are not schedulable; the schedule control is hidden for them
- Dogfood [spec-sync](https://github.com/CorvidLabs/spec-sync) `v6.0.0-rc.12` against `src/lib` (`specs/arc56`, `schedule`, `register`, `abi`, `wallets`). CI runs `specsync check --strict`. [Trust](https://github.com/CorvidLabs/trust) latest is `v1.2.0-rc.4`; this repository does not adopt it.

## What it does not do

- Indexer queries or local state. Boxes list and open (max 64 names) but are not decoded as ABI structs
- Simulate methods that need a `pay` / `axfer` in the group without a wallet (refused, not faked)
- Sign from an embedded preview iframe — wallets need a top-level origin (the live GitHub page)

`call_args` is frozen at register. A keeper decides when the hook runs, never what it says. Policy `1` (`SKIP_AHEAD`) is the default you should mean.

## Specs

Algorand does not store the ABI on chain. The page needs the app spec:

- Drop a `*.arc56.json` (AlgoKit emit)
- Or paste the JSON
- Or open a preset (`docs/Keeper.arc56.json`, `docs/Pulse.arc56.json`)

ARC-32 app specs with a `methods[]` array also parse.

Module contracts for the packing code live in `specs/` and are gated by spec-sync.

## Local

```sh
python3 -m http.server -d docs 8080
```

Open `/` and the Keeper preset loads against TestNet.

## Brand

Tokens, type, and the crow mark are the CorvidLabs design system. Do not re-derive colours.

- Display / body: [Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk)
- Code / labels: [Spline Sans Mono](https://fonts.google.com/specimen/Spline+Sans+Mono)
- Ink `#15181B` · Paper `#FAF9F6` · Sheen `#0E6F66` · no purple
- Theme follows the OS; the sun/moon toggle writes `data-theme` on `<html>`

Vendored copies live in `docs/tokens.css`, `docs/theme.js`, `docs/favicon.svg`. See [NOTICE](NOTICE) — the marks are not Apache-licensed.

## License

Apache-2.0 for the code. Brand assets are reserved; see [NOTICE](NOTICE).
