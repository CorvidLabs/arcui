---
module: register
version: 1
status: active
files:
  - src/lib/register.ts
db_tables: []
depends_on:
  - specs/arc56/arc56.spec.md
---

# register

## Purpose

Same math as `@corvidlabs/arcron` `js/src/upkeep.ts`. Encode `call_args`, price the box, and submit the three-txn `register` group (MBR pay + funding pay + app call) signed by the connected wallet.

## Public API

| Name | Kind | Description |
|------|------|-------------|
| `BOX_MBR_FIXED` | const | `2500 + 400 * 139` (58_100). Box MBR less the argument-list tail. |
| `MIN_UPKEEP_FEE` | const | `4000` µALGO. Floor for `fee_per_execution`. |
| `SUGGESTED_UPKEEP_FEE` | const | `10000` µALGO. Workbench default (0.01 ALGO). |
| `MIN_INTERVAL_ROUNDS` | const | `10`. Mirrors the Keeper contract floor. |
| `MAX_CALL_ARGS` | const | `3`. Selector plus at most two ABI values. |
| `CATCH_UP` | const | Policy `0`. Replay missed intervals. |
| `SKIP_AHEAD` | const | Policy `1`. Run once and keep the phase. |
| `REGISTER_GROUP_SIZE` | const | `3`. Two pays plus the app call. |
| `BOX_NAME_PREFIX` | const | `"u"`. Box names are `"u"` + big-endian uint64. |
| `encodeCallArgs` | function | Pack `byte[][]` as uint16 count, uint16 offsets, then length-prefixed bodies. |
| `boxMbr` | function | `BOX_MBR_FIXED + 400 * encodeCallArgs(callArgs).length`. |
| `upkeepBoxName` | function | 9-byte box name: `'u'` then big-endian uint64 id. |
| `nextUpkeepIdFromApp` | function | Read global-state key `next_upkeep_id`; `0n` if missing. |
| `RegistrationCost` | type | `{ boxDeposit, escrow, networkFees, total }`. |
| `registrationCost` | function | Box MBR + funding + `minFee * REGISTER_GROUP_SIZE`. |
| `RegisterParams` | type | Fields sent to Keeper `register`. |
| `Signing` | type | `{ sender, signer }` for ATC. |
| `registerUpkeep` | function | Build and execute the register group against `keeperAppId`. |
| `submitNoOpCall` | function | Sign a lone NoOp with `appArgs` (simulate-and-call path, not register). |

## Invariants

1. `BOX_MBR_FIXED = 2500 + 400*139`. A box costs that plus `400 * len(encoded call_args)` µALGO: 2_500 per box plus 400 per byte of the 9-byte name and the 130-byte head.
2. Box notes arcron:mbr / arcron:funding. The two payment txns carry those notes so they do not serialise to the same txid when MBR equals funding.
3. `MAX_CALL_ARGS` is 3 so abi args ≤ 2. The contract stores every app arg, selector included. Arcui will not schedule a method that would overflow that.
4. `SKIP_AHEAD` default is policy `1`. This module exports the constant; the workbench and `draftSchedule` pass it unless the user picks `CATCH_UP`.
5. The register group is always three txns: MBR pay, funding pay, `register` method call. Foreign app is the target; box ref is `upkeepBoxName(nextId)`.
6. `upkeepBoxName` is always 9 bytes. The prefix is the ASCII byte of `BOX_NAME_PREFIX`.

## Behavioral Examples

### Scenario: Empty selector-only `call_args`

- **Given** one encoded selector (4 bytes)
- **When** `encodeCallArgs` / `boxMbr` run
- **Then** the packed buffer starts with count `1` and `boxMbr` is `BOX_MBR_FIXED + 400 * packedLength`

### Scenario: Notes distinguish the two pays

- **Given** a register group whose MBR deposit happens to equal funding
- **When** `registerUpkeep` builds the pays
- **Then** one note is `arcron:mbr` and the other is `arcron:funding`

### Scenario: Next id from a live Keeper

- **Given** algod app params whose global-state includes `next_upkeep_id` = 7
- **When** `nextUpkeepIdFromApp` runs
- **Then** it returns `7n`, and that id is the box name passed to ATC

## Error Cases

| Condition | Behavior |
|-----------|----------|
| ATC `decodeError` on the register result | Thrown to the caller; no `{ txId }` is returned |
| Missing `next_upkeep_id` in global state | `nextUpkeepIdFromApp` returns `0n` rather than throwing |
| Wallet not connected | `registerUpkeep` still requires a `TransactionSigner`; the workbench refuses before calling |
| Algod / ATC execution failure | The algosdk error propagates |

## Dependencies

### Consumes

| Module | What is used |
|--------|-------------|
| `arc56` | `b64ToBytes`, `bytesToUtf8` for reading `next_upkeep_id` |
| `algod` | `AlgodApp` type |
| `networks` | `NETWORKS[network].algod` |
| `algosdk` | ATC, payment txn, ABIMethod, application address |

### Consumed By

| Module | What is used |
|--------|-------------|
| `schedule` | `boxMbr`, `MIN_UPKEEP_FEE`, `registrationCost` |

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-09-02 | CorvidLabs | Initial spec-sync dogfood for `src/lib/register.ts`. |
| 2026-09-02 | CorvidLabs | Signer is any connected TxnLab wallet, not Pera-only. |
