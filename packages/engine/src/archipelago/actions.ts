import { addLoan, type PlayerAction } from '../actions';
import { nextUid } from '../offers';
import { INSURANCE_WAIT_WEEKS } from '../rules';
import type { BusinessId, EngineError, Manager, PlayerState, WorldState } from '../types';
import { BUSINESSES, ISLANDS } from './content';
import { build, daysAvailable, humanBusinessCount, humanShare, network, repairPrice, routeCost } from './model';
import * as R from './rules';

export const isArchChoice = (kind: string): boolean => ['partner', 'bankLoan', 'bizBuyer'].includes(kind);
const error = (code: keyof typeof import('../types').ERROR_CODES): EngineError => ({ code });
const cashError = (price: number, cash: number): EngineError | null => cash < price ? { code: 'notEnoughCash', missing: price - cash } : null;
function funding(p: PlayerState, price: number, loan: number): EngineError | null {
  if (!Number.isInteger(loan) || loan < 0) return error('badAmount');
  if (loan > price * R.BUSINESS_LOAN_SHARE) return error('loanTooBig');
  return cashError(price, p.cash + loan);
}
function pay(w: WorldState, p: PlayerState, price: number, loan: number): void {
  if (loan) addLoan(w, p, loan, false);
  p.cash += loan - price;
}
export function managerError(w: WorldState, id: BusinessId, manager: Manager): EngineError | null {
  const a = w.archipelago!;
  if (manager === 'partner') return error('notOwner');
  if (manager === 'owner' && a.businesses.filter((b) => b.id !== id && b.manager === 'owner').length >= daysAvailable(w.players[0])) return error('noDays');
  if (typeof manager === 'object') {
    if (!w.players.some((p) => p.isBot && p.id === manager.neighborId) || !network(a).includes(manager.neighborId)) return error('noRoute');
  }
  return null;
}
export function resolveArchChoice(w: WorldState, p: PlayerState, accept: boolean, loan = 0): EngineError | null {
  const a = w.archipelago;
  if (!a) return error('archClosed');
  if (p !== w.players[0] || p.isBot) return error('notOwner');
  const c = p.choice;
  if (!c || !isArchChoice(c.kind)) return error('noChoice');
  const id = c.params.business as BusinessId;
  if (c.kind === 'partner') {
    const d = BUSINESSES[id];
    const bot = w.players.find((x) => x.id === c.params.botId);
    if (!d || !bot || a.businesses.some((b) => b.id === id)) return error('businessTaken');
    if (accept) {
      if (humanBusinessCount(a) >= R.MAX_HUMAN_BUSINESSES) return error('businessLimit');
      const price = d.price * R.PARTNER_SHARE;
      const err = funding(p, price, loan) ?? cashError(d.price - price, bot.cash);
      if (err) return err;
      pay(w, p, price, loan);
      bot.cash -= d.price - price;
      build(a, id, w.week, bot.id, true);
    } else if (bot.cash >= d.price + R.BOT_BUFFER[bot.id]) {
      bot.cash -= d.price;
      build(a, id, w.week, bot.id);
    }
  } else if (c.kind === 'bankLoan' && accept) {
    const amount = Number(c.params.amount);
    const err = cashError(amount, p.cash);
    if (err) return err;
    p.cash -= amount;
    const borrower = String(c.params.borrower);
    if (borrower !== 'npc') w.players.find((x) => x.id === borrower)!.cash += amount;
    a.loans.push({ uid: nextUid(w, 'arch-loan'), borrower, cls: c.params.cls as 'reliable' | 'normal' | 'risky',
      principal: amount, weeklyRate: Number(c.params.weeklyRate), startWeek: w.week,
      dueWeek: w.week + Number(c.params.term), tries: 0, crisisSeen: false });
    a.log.bankLent += amount;
  } else if (c.kind === 'bizBuyer' && accept) {
    const b = a.businesses.find((b) => b.id === id && humanShare(b) === 1);
    if (!b) return error('notOwner');
    p.cash += Number(c.params.offer);
    b.stakes = [{ playerId: 'mainland', share: 1 }];
    b.manager = 'partner';
  }
  p.choice = null;
  a.log.decisionWeeks.push(w.week);
  return null;
}
export function applyArchAction(w: WorldState, p: PlayerState, action: PlayerAction): EngineError | null {
  if (p !== w.players[0] || p.isBot) return error('notOwner');
  if (action.type === 'deferChoice') {
    if (!p.choice || (p.choice.expiresWeek ?? p.choice.week) <= w.week) return error('cannotDefer');
    p.choice.deferred = true;
    w.archipelago?.log.decisionWeeks.push(w.week);
    return null;
  }
  const a = w.archipelago;
  if (!a) return error('archClosed');
  if (action.type === 'archSeen') { a.seen[action.what] = true; return null; }
  if (action.type === 'buildRoute') {
    if (!ISLANDS[action.island]) return error('noRoute');
    if (a.routes.includes(action.island)) return error('routeBuilt');
    const cost = routeCost(a), err = cashError(cost, p.cash);
    if (err) return err;
    p.cash -= cost;
    a.routes.push(action.island);
  } else if (action.type === 'buyBusiness') {
    const d = BUSINESSES[action.business];
    if (!d || !a.routes.includes(d.island)) return error('noRoute');
    if (a.businesses.some((b) => b.id === d.id)) return error('businessTaken');
    if (humanBusinessCount(a) >= R.MAX_HUMAN_BUSINESSES) return error('businessLimit');
    const err = funding(p, d.price, action.loan);
    if (err) return err;
    pay(w, p, d.price, action.loan);
    build(a, d.id, w.week);
    if (p.choice?.kind === 'partner' && p.choice.params.business === d.id) p.choice = null;
  } else if (action.type === 'setManager' || action.type === 'repairBusiness') {
    const b = a.businesses.find((b) => b.id === action.business);
    if (!b || humanShare(b) <= 0) return error('notOwner');
    if (action.type === 'setManager') {
      if (humanShare(b) !== 1) return error('notOwner');
      const err = managerError(w, b.id, action.manager);
      if (err) return err;
      b.manager = action.manager;
    } else {
      if (!b.damaged) return error('notDamaged');
      const costs = b.stakes.map((s) => ({ p: w.players.find((p) => p.id === s.playerId)!,
        cost: Math.round(BUSINESSES[b.id].price * R.BUSINESS_REPAIR_SHARE * s.share) }));
      for (const c of costs) { const err = cashError(c.cost, c.p.cash); if (err) return err; }
      for (const c of costs) c.p.cash -= c.cost;
      a.pendingRepairs = (a.pendingRepairs ?? 0) + repairPrice(b);
      a.log.repairs += repairPrice(b);
      b.damaged = false;
    }
  } else if (action.type === 'setArchInsurance') {
    if (action.on && a.insuredFrom === null) a.insuredFrom = w.week + INSURANCE_WAIT_WEEKS;
    if (!action.on) a.insuredFrom = null;
  } else return error('unknownAction');
  a.log.decisionWeeks.push(w.week);
  return null;
}
