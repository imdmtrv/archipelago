import { resolvePendingChoice } from '../choices';
import { realFreedomRatio } from '../economy';
import { nextUid } from '../offers';
import type { Rng } from '../rng';
import { FREEDOM_LEVEL_RATIOS } from '../rules';
import type { BankClass, GameEvent, PlayerState, PlayerWeekReport, WorldState } from '../types';
import { BUSINESSES, ISLAND_ORDER } from './content';
import { build, createArch, emptyLines, humanBusinessCount, humanShare, network, reach, repairPrice } from './model';
import * as R from './rules';

/** Called only after the shared cooldown and probability gate. */
export function generateArchChoice(w: WorldState, p: PlayerState, rng: Rng): boolean {
  const a = w.archipelago;
  if (!a || p !== w.players[0] || p.isBot || p.choice) return false;
  const set = (kind: 'partner' | 'bankLoan' | 'bizBuyer', params: Record<string, string | number>) => {
    p.choice = { uid: nextUid(w, 'c'), kind, params, week: w.week + 1,
      ...(kind === 'partner' ? { expiresWeek: w.week + R.PARTNER_WAIT_WEEKS, deferred: false } : {}) };
    p.lastChoiceWeek = w.week;
  };
  for (const [botId, id] of Object.entries(R.BOT_BUILDS)) {
    const bot = w.players.find((x) => x.id === botId);
    if (bot && w.week >= a.openWeek + R.BOT_DELAY && !a.businesses.some((b) => b.id === id)
      && bot.cash >= BUSINESSES[id].price + R.BOT_BUFFER[botId]) {
      set('partner', { botId, business: id }); return true;
    }
  }
  if (a.businesses.some((b) => b.id === 'bank' && !b.damaged && humanShare(b) === 1) && rng.chance(R.BANK_REQUEST_CHANCE)) {
    const needy = network(a).filter((id) => id !== p.id && w.players.some((x) => x.id === id
      && (x.cash < R.NEIGHBOR_NEED_CASH || x.loans.some((l) => l.emergency))));
    const borrower = needy.length && rng.chance(R.BANK_NEIGHBOR_SHARE) ? needy[rng.int(0, needy.length - 1)] : 'npc';
    const classes: Record<string, BankClass> = { 'bot-mia': 'reliable', 'bot-timur': 'normal', 'bot-boris': 'risky' };
    const cls = borrower === 'npc' ? rng.weighted(R.BANK_CLASS_WEIGHTS) : classes[borrower];
    const bot = w.players.find((x) => x.id === borrower);
    const amount = borrower === 'npc' ? Math.round(rng.range(...R.BANK_AMOUNT) / 100) * 100
      : Math.max(R.BANK_AMOUNT[0], Math.min(R.BANK_AMOUNT[1], Math.ceil(((bot?.loans
        .filter((l) => l.emergency).reduce((n, l) => n + l.principal, 0) ?? 0) + 500) / 100) * 100));
    set('bankLoan', { borrower, cls, amount, weeklyRate: R.BANK_RATE[cls], term: rng.int(...R.BANK_TERM) });
    return true;
  }
  for (const b of a.businesses) if (humanShare(b) === 1 && rng.chance(R.BUYER_CHANCE)) {
    set('bizBuyer', { business: b.id, offer: Math.round(BUSINESSES[b.id].price * rng.range(...R.BUYER_PREMIUM)) });
    return true;
  }
  return false;
}

export function settleArchWeek(w: WorldState, reports: Record<string, PlayerWeekReport>, worldEvents: GameEvent[], rng: Rng): void {
  const a = w.archipelago;
  if (!a) return;
  const me = w.players[0], report = reports[me.id], lines = report.arch!;
  const credit = (id: string, amount: number, field: 'businesses' | 'bankInterest' | 'eventsCash' = 'eventsCash') => {
    const p = w.players.find((x) => x.id === id);
    if (!p) return;
    p.cash += amount;
    reports[id].net += amount;
    if (id === me.id && field !== 'eventsCash') lines[field] += amount;
    else reports[id].eventsCash += amount;
  };
  for (const b of a.businesses) if (b.damaged && humanShare(b) === 0 && b.stakes[0].playerId !== 'mainland') {
    const bot = w.players.find((x) => x.id === b.stakes[0].playerId);
    const cost = Math.round(BUSINESSES[b.id].price * R.BUSINESS_REPAIR_SHARE);
    if (bot && bot.cash >= cost) { credit(bot.id, -cost); b.damaged = false; }
  }
  if (worldEvents.some((e) => e.id === 'storm')) {
    const island = ISLAND_ORDER[rng.int(0, ISLAND_ORDER.length - 1)];
    const b = a.businesses.find((b) => BUSINESSES[b.id].island === island);
    if (b && !b.damaged && rng.chance(Math.min(R.STORM_HIT_MAX, BUSINESSES[b.id].stormRisk * R.STORM_HIT_MULT))) {
      const insured = humanShare(b) > 0 && a.insuredFrom !== null && w.week >= a.insuredFrom;
      b.damaged = !insured;
      if (humanShare(b) > 0) {
        if (!insured) lines.damaged.push(b.id);
        report.events.push({ id: insured ? 'archStormInsured' : 'archStorm', tone: insured ? 'neutral' : 'bad',
          params: { business: b.id, island, ...(insured ? {} : { cost: repairPrice(b) }) } });
      }
    }
    const yard = a.businesses.find((b) => b.id === 'shipyard' && !b.damaged);
    if (yard) {
      const repairs = reach(a, 'cedar').reduce((n, id) => n + (reports[id]?.events.filter((e) => e.id === 'stormDamage')
        .reduce((s, e) => s + (e.affectedAssetUids?.length ?? 0), 0) ?? 0), 0);
      for (const s of yard.stakes) if (s.playerId !== 'mainland') {
        const amount = Math.round(R.SHIPYARD_PER_REPAIR * repairs * s.share);
        credit(s.playerId, amount, 'businesses');
        if (s.playerId === me.id) a.log.businessIncome += amount;
        else a.log.paidToNeighbors += amount;
      }
    }
  }
  if (worldEvents.some((e) => e.id === 'crisis')) for (const l of a.loans) l.crisisSeen = true;
  a.loans = a.loans.filter((l) => {
    if (l.dueWeek > w.week) return true;
    let lost = false, returned = l.principal;
    if (l.borrower === 'npc') lost = rng.chance(Math.min(0.95, R.BANK_DEFAULT[l.cls] * (l.crisisSeen ? R.CRISIS_DEFAULT_MULT : 1)));
    else {
      const bot = w.players.find((x) => x.id === l.borrower)!;
      const term = l.dueWeek - l.startWeek - l.tries * R.NEIGHBOR_LOAN_RETRY;
      const interest = Math.round(l.principal * l.weeklyRate * term);
      returned += interest;
      if (bot.cash >= l.principal + interest) {
        credit(bot.id, -l.principal - interest);
        credit(me.id, interest, 'bankInterest');
        a.log.bankInterest += interest;
      } else if (++l.tries < R.NEIGHBOR_LOAN_TRIES) { l.dueWeek += R.NEIGHBOR_LOAN_RETRY; return true; }
      else lost = true;
    }
    if (lost) {
      a.log.bankDefaulted += l.principal;
      lines.bankLost += l.principal;
      // Principal left cash when lent. Release the receivable and write it off together,
      // so the report shows the loss without charging cash a second time.
      report.eventsCash += l.principal;
    } else credit(me.id, l.principal);
    report.events.push({ id: lost ? 'archLoanLost' : 'archLoanRepaid', tone: lost ? 'bad' : 'good',
      params: { borrower: l.borrower, amount: lost ? l.principal : returned } });
    return false;
  });
}

/** End-of-week construction runs before generating the next shared choice. */
export function finishArchWeek(w: WorldState, reports: Record<string, PlayerWeekReport>): void {
  const me = w.players[0], report = reports[me.id];
  if (!w.archipelago && realFreedomRatio(me, w.market, w) >= FREEDOM_LEVEL_RATIOS[1]) {
    w.archipelago = createArch(w.week);
    report.arch = emptyLines();
    report.arch.opened = true;
  }
  const a = w.archipelago;
  if (!a) return;
  for (const p of w.players) if (p.choice && (p.choice.expiresWeek ?? p.choice.week) <= w.week) resolvePendingChoice(w, p, false);
  for (const b of a.businesses) if (b.builtWeek === w.week && humanShare(b) === 0 && b.stakes[0].playerId !== 'mainland')
    report.events.push({ id: 'archNeighborBuilt', tone: 'neutral', params: { botId: b.stakes[0].playerId, business: b.id } });
  if (a.mainlandFrom === null && (humanBusinessCount(a) >= R.MAX_HUMAN_BUSINESSES || w.week >= a.openWeek + R.MAINLAND_FALLBACK)) a.mainlandFrom = w.week;
  if (a.mainlandFrom !== null && w.week >= a.mainlandFrom && (w.week - a.mainlandFrom) % R.MAINLAND_STEP === 0) {
    const next = Object.values(BUSINESSES).filter((d) => !a.businesses.some((b) => b.id === d.id)).sort((a, b) => a.price - b.price)[0];
    if (next) {
      build(a, next.id, w.week, 'mainland');
      if (me.choice?.kind === 'partner' && me.choice.params.business === next.id) me.choice = null;
      report.events.push({ id: 'archMainlandBuilt', tone: 'neutral', params: { business: next.id } });
    }
  }
  if (a.finaleWeek === null && a.routes.length === ISLAND_ORDER.length && a.businesses.length === ISLAND_ORDER.length) {
    a.finaleWeek = w.week;
    report.arch!.finale = true;
    report.events.push({ id: 'archFinale', tone: 'good', params: {} });
  }
}
