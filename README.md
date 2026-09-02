# Arcui

Generated frontend for any Algorand smart contract.

Paste an app id, drop an [ARC-56](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0056.md) spec, and Arcui draws the method forms. Live TestNet presets for [Arcron](https://github.com/CorvidLabs/arcron) Keeper and Pulse ship with the page so there is something real to click on day one.

This is a workbench, not another Arcron console. Any contract with an ARC-56 (or legacy ARC-32) spec is in scope.

## Use it

GitHub Pages (after the workflow has run once):

**https://corvidlabs.github.io/arcui/**

Private repo Pages stays behind GitHub auth. The workflow is already in `.github/workflows/pages.yml`. It cannot turn Pages on by itself — a CorvidLabs owner has to do that once:

1. Open **Settings → Pages**
2. Build and deployment → Source: **GitHub Actions**
3. Re-run **Deploy GitHub Pages** from the Actions tab

Until that click, the site is the static files in `docs/`. Anything that can serve that folder is the same page.

The page talks to [AlgoNode](https://algonode.io) algod from the browser. No indexer. No backend.

### What v0 does

- Load any app id on TestNet or MainNet and decode global state against the spec
- Generate a form per ABI method
- Simulate calls that do not need a group payment (empty-signature simulate, unnamed resources allowed)
- Pack a **Schedule on Arcron** payload for hooks with no group transactions and at most two ABI args — copy `call_args` and open the [Arcron console](https://corvidlabs.xyz/arcron/console/) to sign `register`

### What it does not do yet

- Wallet connect / signed writes
- Methods that require a `pay` / `axfer` in the group (simulate is refused, not faked)
- Indexer queries, local state, or box contents beyond a count

`call_args` is frozen at register. A keeper decides when the hook runs, never what it says. Policy `1` (`SKIP_AHEAD`) is the default you should mean.

## Specs

Algorand does not store the ABI on chain. The page needs the app spec:

- Drop a `*.arc56.json` (AlgoKit emit)
- Or paste the JSON
- Or open a preset (`docs/Keeper.arc56.json`, `docs/Pulse.arc56.json`)

ARC-32 app specs with a `methods[]` array also parse.

## Local

The site is static. Anything that can serve `docs/` works:

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
