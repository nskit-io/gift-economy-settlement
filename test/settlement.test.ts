/**
 * Solvency property test: across many randomized cross-border flows, the platform must
 * never pay out more than it banked. Run: `npm test` (or `npx tsx test/settlement.test.ts`).
 */
import assert from "node:assert";
import { Wallet, SettlementEngine } from "../src/index.js";

// Deterministic LCG so the test is reproducible.
let rng = 12345;
const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const TRIALS = 1000;
const creators = ["kr", "jp", "us"];

for (let trial = 0; trial < TRIALS; trial++) {
  const ratio = 0.4 + rand() * 0.25; // 0.40 .. 0.65
  const engine = new SettlementEngine({ payoutRatio: ratio, now: () => trial * 1000 });

  let banked = 0;   // realized money the platform actually received (paid units only)
  let paidOut = 0;  // cash settled to creators

  for (let g = 0; g < 20; g++) {
    const fan = new Wallet();
    const units = 1000 + Math.floor(rand() * 50000);
    const basis = 0.2 + rand() * 1.1;             // per-market realized value per unit (PPP spread)
    fan.credit(units, units * basis);
    banked += units * basis;
    if (rand() < 0.5) fan.creditFree(Math.floor(units * 0.2)); // some bonus currency (0 realized)
    const gift = fan.spend(fan.total);            // gift everything, free-first
    engine.accrue(creators[g % creators.length], gift, "fan" + g);
  }

  for (const c of creators) paidOut += engine.settle(c);

  assert(
    paidOut <= banked + 1e-6,
    `trial ${trial}: paid ₩${paidOut.toFixed(2)} > banked ₩${banked.toFixed(2)} (ratio ${ratio.toFixed(3)})`,
  );
}

// Ledger reconciliation: entries sum to the available payout.
const w = new Wallet();
w.credit(28000, 28000);
const e = new SettlementEngine({ payoutRatio: 0.8 });
["a", "b", "c", "d"].forEach((f, i) => e.accrue("x", w.spend([5000, 12000, 3000, 8000][i]), f));
const sum = e.ledger("x").reduce((s, r) => s + r.payout, 0);
assert(Math.abs(sum - e.available("x")) < 1e-6, `ledger ${sum} != available ${e.available("x")}`);

console.log(`✓ ${TRIALS} randomized cross-border trials — platform solvent in all`);
console.log(`✓ FIFO ledger reconciles to available payout`);
