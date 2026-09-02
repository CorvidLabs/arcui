---
module: abi
version: 1
status: active
files:
  - src/lib/abi.ts
db_tables: []
depends_on:
  - specs/arc56/arc56.spec.md
---

# abi

## Purpose

Encode an ARC-4 method call for simulate or register, run an empty-signature simulate against AlgoNode, and decode the ABI return from the last log. Group-txn methods are refused here: simulate without a wallet cannot attach a `pay` / `axfer`.

## Public API

| Name | Kind | Description |
|------|------|-------------|
| `buildMethodCall` | function | Build ARC-4 selector + encoded ABI args from a spec method and string values. Skips txn-typed args. |
| `SimulateResult` | type | `{ ok, message, returnValue?, logs }`. |
| `simulateMethod` | function | Simulate a NoOp against `appId`. Refuses methods that need a group transaction. |
| `decodeAbiReturn` | function | Decode the ARC-4 return log (`0x151f7c75` prefix) as string / uint / bool / address / hex. |
| `abiArgs` | function | Re-export of `arc56.abiArgs`. Non-txn args of a method. |

## Invariants

1. `buildMethodCall` always prefixes `encoded` with the 4-byte selector. ABI values follow in method-arg order, txn types omitted.
2. `MAX_CALL_ARGS` is 3 so ABI args ≤ 2 for anything that will be scheduled. This module will still encode more than two args for simulate/call; schedule eligibility lives in `isSchedulable`.
3. Simulate without a wallet is limited to methods that take no transactions. A `pay` / `axfer` / other `isTxnType` arg returns `{ ok: false }` with that explanation and does not hit algod.
4. Fee-only simulate failures (`overspend`, min fee, fee too small/low) are treated as success. Empty-signature simulate often cannot pay; the opcode still ran.
5. `decodeAbiReturn` requires the ARC-4 log prefix `15 1f 7c 75`. Anything else, or `void`, or no logs, returns `undefined`.
6. Without a connected sender the simulate txn uses fee `0` and a generated account. With a sender it uses `minFee`.

## Behavioral Examples

### Scenario: Selector-only `tick`

- **Given** Pulse `tick` with no args
- **When** `buildMethodCall` runs
- **Then** `encoded` is `[selector]` and `signature` is the ARC-4 method signature

### Scenario: Group-txn simulate is refused

- **Given** Keeper `register`, whose first args are `pay`
- **When** `simulateMethod` runs
- **Then** it returns `{ ok: false, logs: [] }` and the message that simulate without a wallet cannot attach a payment or asset transfer

### Scenario: Uint return from the last log

- **Given** a successful simulate whose last log is the ARC-4 prefix plus a big-endian uint
- **When** `decodeAbiReturn` runs with a `uint64` type
- **Then** the decimal string of that integer is the return value

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `uint*` / `asset` / `application` value is not digits | Throws `Expected integer for <type>` |
| `byte[][]` value is not a JSON array | Throws `byte[][] expects a JSON array of strings` |
| `byte[][]` item is not a string | Throws `byte[][] items must be strings` |
| `struct` name missing from `spec.structs` | Throws `Unknown struct <name>` |
| Method has a txn-typed arg | `simulateMethod` returns the group-txn refusal; does not throw |
| Last log missing the ARC-4 prefix | `decodeAbiReturn` returns `undefined` |
| `type === "void"` or no logs | `decodeAbiReturn` returns `undefined` |
| Invalid base64 log | `decodeAbiReturn` returns `undefined` |

## Dependencies

### Consumes

| Module | What is used |
|--------|-------------|
| `arc56` | `abiArgs`, `isTxnType`, `Arc56Method`, `Arc56Spec` |
| `networks` | `NETWORKS[network].algod` |
| `algosdk` | `ABIMethod`, `ABIType`, ATC simulate, empty signer, generated account |

### Consumed By

| Module | What is used |
|--------|-------------|
| `schedule` | `buildMethodCall` |

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-09-02 | CorvidLabs | Initial spec-sync dogfood for `src/lib/abi.ts`. |
