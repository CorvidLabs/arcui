---
module: schedule
version: 1
status: active
files:
  - src/lib/schedule.ts
db_tables: []
depends_on:
  - specs/arc56/arc56.spec.md
  - specs/abi/abi.spec.md
  - specs/register/register.spec.md
---

# schedule

## Purpose

Draft an Arcron upkeep payload from a schedulable ARC-56 method. `draftSchedule` freezes `call_args` the way `register` will store them, prices the box deposit and escrow, and labels the cadence and catch-up policy for the workbench.

## Public API

| Name | Kind | Description |
|------|------|-------------|
| `ScheduleDraft` | type | Frozen upkeep preview: target, method, signature, hex `call_args`, interval, fee, policy, box deposit, funding, total. |
| `INTERVALS` | const | Cadence presets in rounds: ~1 minute (23), ~5 minutes (111), ~1 hour (1286), ~1 day (30857). |
| `draftSchedule` | function | Encode the method via `buildMethodCall`, clamp the fee to `MIN_UPKEEP_FEE`, default 10 executions, return a `ScheduleDraft`. |

## Invariants

1. `SKIP_AHEAD` default. Policy `1` labels as `SKIP_AHEAD`; any other policy labels as `CATCH_UP`. The draft note says so in plain language.
2. `call_args` is frozen at register. The draft hex is the encoded selector plus ABI values `register` will store. A keeper decides when this runs, never what it says.
3. Fee is `max(MIN_UPKEEP_FEE, round(feeAlgo * 1_000_000))`. A typed `0.01` ALGO becomes 10_000 µALGO; anything below 4_000 µALGO is raised.
4. Funding is `feeMicro * executions`. `executions` defaults to 10.
5. `boxDeposit` is `boxMbr(encoded)`. `totalMicro` is `registrationCost` of that encoding plus funding plus the three-txn group fee.
6. An interval that is not in `INTERVALS` still drafts; `intervalLabel` falls back to `"N rounds"`.

## Behavioral Examples

### Scenario: Pulse `tick` on the hour, SKIP_AHEAD

- **Given** Pulse `tick` with no args, interval 1286, fee 0.01 ALGO, policy 1
- **When** `draftSchedule` runs
- **Then** `intervalLabel` is `~1 hour`, `policyLabel` is `SKIP_AHEAD`, `callArgsHex` is the selector only, and `executions` is 10

### Scenario: `tick_with` freezes both arguments

- **Given** `tick_with(uint64,string)` with values `7` and `arcron`
- **When** `draftSchedule` runs
- **Then** `callArgsHex` has three entries (selector + two ABI values) and `signature` is `tick_with(uint64,string)void` or whatever the spec returns

### Scenario: Fee floor

- **Given** `feeAlgo` of `0`
- **When** `draftSchedule` runs
- **Then** `feeMicro` is `MIN_UPKEEP_FEE` (4_000), not zero

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `buildMethodCall` rejects a value (bad integer, bad `byte[][]`, unknown struct) | `draftSchedule` rejects with that error; no draft is returned |
| Missing spec / method | TypeScript callers must pass both; this module does not re-validate ARC-56 shape |

## Dependencies

### Consumes

| Module | What is used |
|--------|-------------|
| `arc56` | `methodSignature`, `Arc56Method`, `Arc56Spec` |
| `abi` | `buildMethodCall` |
| `register` | `boxMbr`, `MIN_UPKEEP_FEE`, `registrationCost` |
| `networks` | `ARCRON.skipAhead`, `ARCRON.testnetAppId`, `ARCRON.console` |

### Consumed By

The workbench (`src/components/workbench.tsx`) is the only caller. It is UI, not a specced module.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-09-02 | CorvidLabs | Initial spec-sync dogfood for `src/lib/schedule.ts`. |
