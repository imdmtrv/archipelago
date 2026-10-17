import type { ArchState, ArchWeekLines, BusinessId, BusinessState, IslandId, Manager, PlayerState, WorldState } from '../types';
import { INCOME_BONUS, INCOME_BONUS_KNOWLEDGE } from '../rules';
import { BUSINESSES, ISLANDS, SETS } from './content';
import * as R from './rules';

export function createArch(openWeek: number): ArchState {
  return { openWeek, routes: [], businesses: [], loans: [], insuredFrom: null, mainlandFrom: null,
    finaleWeek: null, seen: { intro: false, finale: false }, pendingRepairs: 0,
    log: { decisionWeeks: [], homeDecisionWeeks: [], paidToNeighbors: 0, bankLent: 0,
      bankDefaulted: 0, bankInterest: 0, repairs: 0, businessIncome: 0 } };
}
export const emptyLines = (): ArchWeekLines => ({ businesses: 0, managers: 0, routes: 0, bankInterest: 0,
  bankLost: 0, upkeep: 0, insurance: 0, repairs: 0, damaged: [], opened: false, finale: false });
export const linesNet = (l: ArchWeekLines): number => l.businesses - l.managers + l.routes + l.bankInterest
  - l.bankLost - l.upkeep - l.insurance - l.repairs;
export const humanShare = (b: BusinessState): number => b.stakes.find((s) => s.playerId === 'p1')?.share ?? 0;
export const humanBusinessCount = (a: ArchState): number => a.businesses.filter((b) => humanShare(b) > 0).length;
export const daysAvailable = (p: PlayerState): number => p.dream?.building ? 0 : p.employed ? R.DAYS_EMPLOYED : R.DAYS_FREE;
export const network = (a: ArchState): string[] => ['p1', ...a.routes.flatMap((i) => ISLANDS[i].resident ? [ISLANDS[i].resident!] : [])];
export const reach = (a: ArchState, i: IslandId): string[] => a.routes.includes(i) ? network(a) : ISLANDS[i].resident ? [ISLANDS[i].resident!] : [];
export const intact = (a: ArchState, id: BusinessId): boolean => a.businesses.some((b) => b.id === id && !b.damaged);
export const activeSets = (a: ArchState): (keyof typeof SETS)[] => (Object.keys(SETS) as (keyof typeof SETS)[])
  .filter((set) => SETS[set].every((id) => a.businesses.some((b) => b.id === id && humanShare(b) > 0)));
export const routeCost = (a: ArchState): number => Math.round(R.ROUTE_COST * (intact(a, 'shipyard') ? 1 - R.SHIPYARD_ROUTE_DISCOUNT : 1));
export const repairPrice = (b: BusinessState): number => Math.round(BUSINESSES[b.id].price * R.BUSINESS_REPAIR_SHARE * humanShare(b));
export function businessValue(b: BusinessState, playerId = 'p1'): number {
  return Math.round(BUSINESSES[b.id].price * (b.stakes.find((s) => s.playerId === playerId)?.share ?? 0)
    * (BUSINESSES[b.id].resaleRate - (b.damaged ? R.BUSINESS_REPAIR_SHARE : 0)));
}
export function grossIncome(w: WorldState, a: ArchState, b: BusinessState): number {
  if (b.damaged) return 0;
  const d = BUSINESSES[b.id];
  let gross = d.baseIncome;
  if (b.id === 'cannery') {
    const boats = reach(a, 'pelican').reduce((n, id) => n + (w.players.find((p) => p.id === id)?.owned
      .filter((x) => x.defId === 'boat' && !x.damaged).length ?? 0), 0);
    const fish = intact(a, 'coldStore') && a.routes.includes('lighthouse') && a.routes.includes('pelican')
      ? Math.max(w.market.fish, R.COLD_STORE_FISH_FLOOR) : w.market.fish;
    gross = Math.round(d.baseIncome * fish + R.CANNERY_PER_BOAT * boats);
  } else if (b.id === 'hotel') gross = Math.round(d.baseIncome * w.market.tourism * (1 + R.HOTEL_PER_ISLAND * reach(a, 'shell').length));
  else if (b.id === 'shipyard') gross = Math.round(d.baseIncome + R.SHIPYARD_PER_ROUTE * a.routes.length);
  return activeSets(a).some((s) => SETS[s].includes(b.id)) ? Math.round(gross * (1 + R.SET_BONUS)) : gross;
}
export const managerFee = (gross: number, m: Manager): number => Math.round(gross * (m === 'hired'
  ? R.HIRED_MANAGER_SHARE : typeof m === 'object' ? R.NEIGHBOR_MANAGER_SHARE : 0));
// The prototype booked manager fees as stable-sector deposit income. Preserve its
// two rounding steps and knowledge bonus without creating synthetic assets.
export function managementIncome(fee: number, p: PlayerState): number {
  const bonus = p.knowledge >= INCOME_BONUS_KNOWLEDGE ? 1 + INCOME_BONUS : 1;
  return Math.round(Math.round(fee / bonus) * bonus);
}
export function normalizeManagers(w: WorldState): void {
  const a = w.archipelago;
  if (!a) return;
  let days = daysAvailable(w.players[0]);
  for (const b of a.businesses) if (b.manager === 'owner' && days-- <= 0) b.manager = 'hired';
}
export function fishBonus(w: WorldState | undefined, p: PlayerState): number {
  const a = w?.archipelago;
  if (!a || !w) return 0;
  const base = p.owned.filter((x) => !x.damaged && (x.defId === 'boat' || x.defId === 'smokehouse')).reduce((n, x) => n + x.income, 0);
  const eff = intact(a, 'coldStore') && reach(a, 'lighthouse').includes(p.id) ? Math.max(w.market.fish, R.COLD_STORE_FISH_FLOOR) : w.market.fish;
  const bonus = intact(a, 'cannery') && reach(a, 'pelican').includes(p.id) ? R.CANNERY_FISH_BONUS : 0;
  return Math.round(base * (eff * (1 + bonus) - w.market.fish));
}
export function archProjection(w: WorldState | undefined, p: PlayerState) {
  const lines = emptyLines();
  const a = w?.archipelago;
  let management = 0;
  if (a && w) {
    let days = daysAvailable(w.players[0]);
    for (const b of a.businesses) {
      const gross = grossIncome(w, a, b);
      const manager = b.manager === 'owner' && days-- <= 0 ? 'hired' : b.manager;
      const fee = managerFee(gross, manager);
      if (typeof manager === 'object' && manager.neighborId === p.id) management += managementIncome(fee, p);
      const share = b.stakes.find((s) => s.playerId === p.id)?.share ?? 0;
      lines.businesses += Math.round(gross * share);
      // Round the owner's net share exactly as in the prototype.
      lines.managers += Math.round(gross * share) - Math.round((gross - fee) * share);
      lines.upkeep += Math.round(BUSINESSES[b.id].upkeep * share);
      if (!p.isBot && a.insuredFrom !== null && BUSINESSES[b.id].stormRisk > 0)
        lines.insurance += Math.round(R.BUSINESS_INSURANCE_RATE * BUSINESSES[b.id].price * share);
    }
    if (p.id === w.players[0].id) {
      lines.routes = Math.round(R.ROUTE_TICKETS * w.market.tourism * a.routes.length) - R.ROUTE_UPKEEP * a.routes.length;
      lines.bankInterest = a.loans.filter((l) => l.startWeek <= w.week && l.dueWeek >= w.week)
        .reduce((n, l) => n + Math.round(l.principal * l.weeklyRate), 0);
    }
  }
  return { lines, management, income: lines.businesses - lines.managers + management
    + (a && w && p.id === w.players[0].id ? Math.round(R.ROUTE_TICKETS * w.market.tourism * a.routes.length) : 0) + lines.bankInterest,
    expenses: lines.upkeep + lines.insurance + (a && w && p.id === w.players[0].id ? R.ROUTE_UPKEEP * a.routes.length : 0) };
}
export function build(a: ArchState, id: BusinessId, week: number, botId?: string, partner = false): void {
  a.businesses.push({ id, damaged: false, builtWeek: week, manager: botId ? 'partner' : 'owner',
    stakes: botId ? partner ? [{ playerId: 'p1', share: R.PARTNER_SHARE }, { playerId: botId, share: 1 - R.PARTNER_SHARE }]
      : [{ playerId: botId, share: 1 }] : [{ playerId: 'p1', share: 1 }] });
}
