import { ARCRON } from "./networks";
import { methodSignature, type Arc56Method, type Arc56Spec } from "./arc56";
import { buildMethodCall } from "./abi";
import { boxMbr, MIN_UPKEEP_FEE, registrationCost } from "./register";

export type ScheduleDraft = {
  targetApp: number;
  method: string;
  signature: string;
  callArgsHex: string[];
  intervalRounds: number;
  intervalLabel: string;
  feeMicro: number;
  policy: number;
  policyLabel: string;
  feeCap: number;
  keeperAppId: number;
  consoleUrl: string;
  note: string;
  boxDeposit: number;
  funding: number;
  executions: number;
  totalMicro: number;
};

export const INTERVALS = [
  { label: "~1 minute", rounds: 23 },
  { label: "~5 minutes", rounds: 111 },
  { label: "~1 hour", rounds: 1286 },
  { label: "~1 day", rounds: 30857 },
];

function bytesToHex(bytes: Uint8Array) {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function draftSchedule(opts: {
  spec: Arc56Spec;
  method: Arc56Method;
  values: Record<string, string>;
  targetApp: number;
  intervalRounds: number;
  feeAlgo: number;
  policy: number;
  executions?: number;
}): Promise<ScheduleDraft> {
  const built = await buildMethodCall(opts.spec, opts.method, opts.values);
  const interval = INTERVALS.find((i) => i.rounds === opts.intervalRounds);
  const feeMicro = Math.max(MIN_UPKEEP_FEE, Math.round((opts.feeAlgo || 0.01) * 1_000_000));
  const executions = opts.executions ?? 10;
  const funding = feeMicro * executions;
  const cost = registrationCost({ callArgs: built.encoded, funding, minFee: 1_000 });
  return {
    targetApp: opts.targetApp,
    method: opts.method.name,
    signature: methodSignature(opts.method),
    callArgsHex: built.encoded.map(bytesToHex),
    intervalRounds: opts.intervalRounds,
    intervalLabel: interval?.label ?? `${opts.intervalRounds} rounds`,
    feeMicro,
    policy: opts.policy,
    policyLabel: opts.policy === ARCRON.skipAhead ? "SKIP_AHEAD" : "CATCH_UP",
    feeCap: 0,
    keeperAppId: ARCRON.testnetAppId,
    consoleUrl: ARCRON.console,
    note:
      "call_args is frozen at register. A keeper decides when this runs, never what it says. Policy 1 (SKIP_AHEAD) is the default you should mean.",
    boxDeposit: boxMbr(built.encoded),
    funding,
    executions,
    totalMicro: cost.total,
  };
}
