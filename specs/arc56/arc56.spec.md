---
module: arc56
version: 1
status: active
files:
  - src/lib/arc56.ts
db_tables: []
depends_on: []
---

# arc56

## Purpose

Parse an ARC-56 (or ARC-32-shaped) application spec and classify its methods for the workbench. This module is the contract between a dropped JSON file and the rest of Arcui: method signatures, ABI vs group-txn args, which methods may become Arcron upkeeps, and how algod global-state rows are labelled.

## Public API

| Name | Kind | Description |
|------|------|-------------|
| `Arc56Arg` | type | One method argument: `name`, `type`, optional `desc` / `struct` / `defaultValue`. |
| `Arc56Method` | type | One ABI method: `name`, `args`, optional `returns`, `readonly`, `events`, `actions`. |
| `StorageKey` | type | Spec storage key metadata used to label global state. |
| `Arc56Spec` | type | Parsed spec: `name`, `methods[]`, optional `structs`, `state`, `events`, `networks`. |
| `parseSpec` | function | Validate `raw` is an object with `name` and `methods[]`; return it as `Arc56Spec`. |
| `isTxnType` | function | True for Algorand group-txn ABI types: `pay`, `axfer`, `acfg`, `afrz`, `appl`, `keyreg`, `stpf`, `txn`. |
| `methodSignature` | function | ARC-4 selector string `name(type,… )ret`. Missing return type becomes `void`. |
| `abiArgs` | function | Method args whose type is not a group transaction. |
| `txnArgs` | function | Method args whose type is a group transaction. |
| `isAdminMethod` | function | True when the method name is `update` or `freeze`, or `actions.call` contains `UpdateApplication` or `DeleteApplication`. |
| `isSchedulable` | function | True when the method is a NoOp Arcron hook: not readonly, not admin, no group txns, at most two ABI args. |
| `defaultArgValue` | function | Literal from `defaultValue.source === "literal"`; else `"0"` for `uint*` / `asset` / `application`, `"false"` for `bool`, otherwise `""`. |
| `methodKind` | function | `"readonly"` if readonly, `"schedule"` if `isSchedulable`, otherwise `"write"`. |
| `DecodedState` | type | One decoded global-state row: `key`, `label`, `kind` (`uint` \| `bytes`), `display`, `raw`. |
| `b64ToBytes` | function | Decode a base64 string to `Uint8Array` via `atob`. |
| `bytesToUtf8` | function | UTF-8 decode; empty string on failure. |
| `bytesToHex` | function | Lowercase hex without a `0x` prefix. |
| `decodeGlobalState` | function | Map algod `{key, value}` rows to `DecodedState[]`, labelling from `spec.state.keys.global` when present. |
| `frozenFromState` | function | `true` / `false` when a `frozen` row is `"1"` / not, or `null` when no such row exists. |

## Invariants

1. `isSchedulable` refuses update/freeze and UpdateApplication. Those are creator/admin calls, not hooks. An Arcron upkeep must be a NoOp. `DeleteApplication` is refused the same way.
2. `MAX_CALL_ARGS` is 3 so abi args ≤ 2. The selector occupies one app-arg slot; two encoded ABI values is the most Arcron `execute` will carry.
3. Readonly methods are never schedulable. Group-txn methods (`pay` / `axfer` / …) are never schedulable.
4. `methodKind` is a partition: readonly, else schedulable, else write. Admin methods surface as `"write"`.
5. `parseSpec` does not deep-validate methods. A missing `name` or non-array `methods` is fatal; everything else is trusted as `Arc56Spec`.
6. `frozenFromState` only treats the row labelled or keyed `frozen` as a boolean, and only `"1"` as frozen.

## Behavioral Examples

### Scenario: A Pulse `tick` is a hook

- **Given** a method named `tick` with no args, not readonly, and no `actions.call`
- **When** `isSchedulable` / `methodKind` run
- **Then** it is schedulable and kind is `"schedule"`

### Scenario: Keeper `update` is hidden from schedule

- **Given** a method named `update`, or one whose `actions.call` includes `UpdateApplication`
- **When** `isSchedulable` runs
- **Then** it returns false. The workbench does not offer Schedule on Arcron for it.

### Scenario: Two ABI args fit, three do not

- **Given** `tick_with(uint64,string)` versus a method with three uint64 ABI args
- **When** `isSchedulable` runs
- **Then** the two-arg method is schedulable (`MAX_CALL_ARGS` is 3 so ABI args ≤ 2) and the three-arg method is not

### Scenario: Decode `frozen` from global state

- **Given** algod global-state rows including a key that labels as `frozen` with uint `1`
- **When** `decodeGlobalState` then `frozenFromState` run
- **Then** the workbench can show the app as frozen

### Scenario: Default form values

- **Given** a `uint64` arg with no `defaultValue`, a `bool` arg, and a `string` arg whose `defaultValue.source` is `"literal"`
- **When** `defaultArgValue` runs
- **Then** the uint is `"0"`, the bool is `"false"`, and the string is the literal `data`

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `parseSpec` given `null`, a string, or a non-object | Throws `Spec is not an object` |
| Object missing `name` | Throws `Spec is missing name` |
| `methods` missing or not an array | Throws `Spec is missing methods[]` |
| `b64ToBytes` given invalid base64 | `atob` throws; callers must pass algod-shaped keys |
| `isSchedulable` / `isAdminMethod` / `methodKind` | Do not throw; they return booleans / a kind |
| Spec without a `frozen` key | `frozenFromState` returns `null`, not `false` |

## Dependencies

### Consumes

None. This module has no imports.

### Consumed By

| Module | What is used |
|--------|-------------|
| `abi` | `abiArgs`, `isTxnType`, `Arc56Method`, `Arc56Spec` |
| `register` | `b64ToBytes`, `bytesToUtf8` |
| `schedule` | `methodSignature`, `Arc56Method`, `Arc56Spec` |

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-09-02 | CorvidLabs | Initial spec-sync dogfood for `src/lib/arc56.ts`. |
