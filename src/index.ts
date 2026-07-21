/**
 * Gift Economy Settlement — realized-value settlement + FIFO ledger.
 *
 * A framework-agnostic reference implementation. No dependencies. Port it anywhere.
 * The currency's face value is a display fiction; settlement runs on realized revenue,
 * so the platform stays solvent across any PPP spread or cross-border mix.
 *
 * MIT © Neoulsoft Inc.  https://github.com/nskit-io/gift-economy-settlement
 */

/** The result of spending currency: free portion (non-settleable) + paid portion (carries realized value). */
export interface GiftPortion {
  /** Units spent from the free/bonus balance — cost-basis 0, never settleable. */
  freeUnits: number;
  /** Units spent from the paid balance. */
  paidUnits: number;
  /** Money backing the paid portion = paidUnits × cost-basis. This is what accrues to a creator. */
  realizedValue: number;
}

/**
 * A user's currency balance with a blended realized cost-basis.
 *
 * `credit` records how much money the platform actually netted for the units bought
 * (after store/PG fees, at the local PPP price). Spending is free-first, then paid,
 * and the paid portion carries its realized value to whoever receives the gift.
 */
export class Wallet {
  private paidUnits = 0;
  private paidRealized = 0; // realized money currently backing the paid units
  private freeUnits = 0;

  /** Buy paid currency. `realized` = money the platform actually received (net of fees, local price). */
  credit(units: number, realized: number): void {
    if (units <= 0) return;
    this.paidUnits += units;
    this.paidRealized += Math.max(0, realized);
  }

  /** Grant free/bonus currency — cost-basis 0, never creates a settlement liability. */
  creditFree(units: number): void {
    if (units > 0) this.freeUnits += units;
  }

  /** Blended realized cost-basis (money per paid unit). */
  basis(): number {
    return this.paidUnits > 0 ? this.paidRealized / this.paidUnits : 0;
  }

  get paid(): number { return this.paidUnits; }
  get free(): number { return this.freeUnits; }
  get total(): number { return this.paidUnits + this.freeUnits; }

  /** Spend `units`, free-first then paid. The paid portion carries its realized value. */
  spend(units: number): GiftPortion {
    if (units <= 0) throw new Error("units must be positive");
    if (units > this.total) throw new Error("insufficient balance");
    const freeUnits = Math.min(this.freeUnits, units);
    const paidUnits = units - freeUnits;
    const realizedValue = paidUnits * this.basis();
    this.freeUnits -= freeUnits;
    this.paidUnits -= paidUnits;
    this.paidRealized -= realizedValue; // basis of the remaining units is unchanged
    return { freeUnits, paidUnits, realizedValue };
  }
}

/** One received gift's paid portion, logged for settlement. */
export interface Accrual {
  ts: number;
  units: number;    // paid units received
  realized: number; // money backing them
  from?: string;
}

/** A ledger row: an accrual with the portion still pending (FIFO) and its cash payout. */
export interface LedgerEntry extends Accrual {
  pendingRealized: number;
  payout: number;
}

export interface SettlementConfig {
  /** Fraction of realized revenue paid to the creator, in (0, 1). Solvency requires < 1. */
  payoutRatio: number;
  /** Clock injection (tests/determinism). Defaults to Date.now. */
  now?: () => number;
}

/**
 * Accrues gifts per creator and settles on realized value.
 *
 * `available` = pending realized × payoutRatio (always ≤ realized ⇒ platform margin ≥ 0).
 * `ledger`    = the oldest-first accruals composing the available payout (transparency).
 * `settle`    = withdraw, consuming realized oldest-first (FIFO), returns cash.
 */
export class SettlementEngine {
  private ratio: number;
  private now: () => number;
  private book = new Map<string, { entries: Accrual[]; settledRealized: number }>();

  constructor(cfg: SettlementConfig) {
    if (!(cfg.payoutRatio > 0 && cfg.payoutRatio < 1)) {
      throw new Error("payoutRatio must be in (0, 1) — a ratio of realized revenue, not face value");
    }
    this.ratio = cfg.payoutRatio;
    this.now = cfg.now ?? (() => Date.now());
  }

  private acct(id: string) {
    let a = this.book.get(id);
    if (!a) { a = { entries: [], settledRealized: 0 }; this.book.set(id, a); }
    return a;
  }

  /** Record a received gift. Only the paid portion accrues; free currency is non-settleable. */
  accrue(creatorId: string, gift: GiftPortion, from?: string): void {
    if (gift.paidUnits <= 0 || gift.realizedValue <= 0) return;
    this.acct(creatorId).entries.push({ ts: this.now(), units: gift.paidUnits, realized: gift.realizedValue, from });
  }

  private pendingRealized(id: string): number {
    const a = this.acct(id);
    const total = a.entries.reduce((s, e) => s + e.realized, 0);
    return Math.max(0, total - a.settledRealized);
  }

  /** Cash the creator can withdraw now = pending realized × ratio. */
  available(creatorId: string): number {
    return round2(this.pendingRealized(creatorId) * this.ratio);
  }

  /** FIFO ledger — the accruals (oldest first) that compose the available payout. Sums to `available`. */
  ledger(creatorId: string): LedgerEntry[] {
    const a = this.acct(creatorId);
    let cum = 0;
    const out: LedgerEntry[] = [];
    for (const e of a.entries) {
      const start = cum;
      cum += e.realized;
      if (cum <= a.settledRealized) continue; // fully settled already
      const pending = cum - Math.max(start, a.settledRealized);
      out.push({ ...e, pendingRealized: round2(pending), payout: round2(pending * this.ratio) });
    }
    return out;
  }

  /** Withdraw up to `amountRealized` (default: all pending), oldest-first. Returns cash payout. */
  settle(creatorId: string, amountRealized?: number): number {
    const pending = this.pendingRealized(creatorId);
    const take = amountRealized === undefined ? pending : Math.min(Math.max(0, amountRealized), pending);
    this.acct(creatorId).settledRealized += take;
    return round2(take * this.ratio);
  }

  /** Lifetime realized banked for a creator — for platform-level solvency accounting. */
  realizedTotal(creatorId: string): number {
    return round2(this.acct(creatorId).entries.reduce((s, e) => s + e.realized, 0));
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
