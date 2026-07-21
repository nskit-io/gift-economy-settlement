/**
 * The K-wave flow: a fan in Jakarta buys stars cheaply (PPP price), gifts them to a
 * creator in Seoul. Under face-value settlement this loses money on the dominant lane.
 * Under realized-value settlement it earns margin. Run: `npx tsx examples/k-wave.ts`
 */
import { Wallet, SettlementEngine } from "../src/index.js";

const PAYOUT_RATIO = 0.6;
const engine = new SettlementEngine({ payoutRatio: PAYOUT_RATIO });

// Jakarta fan bought 10,000 stars; the platform netted ₩4,000 (local PPP price, minus store fee).
const fan = new Wallet();
fan.credit(10_000, 4_000); // cost-basis 0.40 ₩/star
console.log(`fan basis: ₩${fan.basis().toFixed(2)}/star`);

// Fan gifts all 10,000 paid stars to the Seoul creator.
const gift = fan.spend(10_000);
engine.accrue("creator:seoul", gift, "@jakarta_fan");

const realized = engine.realizedTotal("creator:seoul");
const payout = engine.available("creator:seoul");
console.log(`\nrealized banked:  ₩${realized}`);
console.log(`creator withdraws: ₩${payout}`);
console.log(`platform margin:   ₩${(realized - payout).toFixed(2)}  (≥ 0 — solvent on the K-wave lane)`);
console.log(`face-value would have paid ₩${(10_000 * PAYOUT_RATIO).toFixed(0)} on ₩${4_000} banked → LOSS.`);

console.log(`\nledger (oldest first, reconciles to payout):`);
for (const e of engine.ledger("creator:seoul")) console.log(`  ${e.from} · ${e.units} stars → ₩${e.payout}`);

// Free currency never settles: a bonus gift adds cheer but ₩0 to the creator's cash.
const bonusFan = new Wallet();
bonusFan.creditFree(5_000);
engine.accrue("creator:seoul", bonusFan.spend(5_000), "@bonus_fan");
console.log(`\nafter a 5,000 free-currency gift, withdrawable is still ₩${engine.available("creator:seoul")} (free = non-settleable).`);
