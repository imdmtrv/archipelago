// Селектор архипелага для UI. Контракт — types.ts (ArchipelagoView), смысл полей — docs/specs/archipelago-screen.md.
import type { ArchipelagoView, ArchIslandView, EngineError, IslandId, Manager, WorldState } from '../types';
import { financeView } from '../selectors';
import { addLoan } from '../actions';
import { BUSINESSES, ISLANDS, SETS } from './content';
import { managerError } from './actions';
import { archProjection, businessValue, daysAvailable, grossIncome, humanBusinessCount, humanShare, managerFee, repairPrice, routeCost } from './model';
import * as R from './rules';

/** Порядок островов на карте и в панели (не путать с порядком обхода в правилах). */
export const ARCH_MAP_ORDER: IslandId[] = ['lighthouse', 'pelican', 'shell', 'cedar', 'big'];

/** null — архипелаг ещё закрыт (world.archipelago === null). */
export function archipelagoView(world: WorldState, playerId: string): ArchipelagoView | null {
  const a = world.archipelago, me = world.players[0];
  if (!a || playerId !== me.id || me.isBot) return null;
  const count = humanBusinessCount(a);
  const islands = ARCH_MAP_ORDER.map((island): ArchIslandView => {
    const d = BUSINESSES[ISLANDS[island].business];
    const b = a.businesses.find((b) => b.id === d.id), share = b ? humanShare(b) : 0;
    const route = a.routes.includes(island);
    const pending = me.choice?.kind === 'partner' && me.choice.params.business === d.id ? me.choice : null;
    const status = b ? share === 1 ? 'mine' : share > 0 ? 'partner'
      : b.stakes[0].playerId === 'mainland' ? 'mainland' : 'neighbor' : route ? 'free' : 'noRoute';
    const result: ArchIslandView = { island, business: d.id, resident: ISLANDS[island].resident,
      status, owner: b ? [...b.stakes].sort((a, b) => b.share - a.share)[0].playerId : null,
      damaged: b?.damaged ?? false, sets: (Object.keys(SETS) as (keyof typeof SETS)[]).filter((s) => SETS[s].includes(d.id)),
      route: null, buy: null, own: null,
      effectOnYou: !!b && !b.damaged && (b.id === 'shipyard' || route && ['cannery', 'coldStore'].includes(b.id)),
      partnerOfferUntil: pending ? pending.expiresWeek ?? pending.week : null, attention: false };
    if (!route) {
      const cost = routeCost(a), reason: EngineError | undefined = me.cash < cost ? { code: 'notEnoughCash', missing: cost - me.cash } : undefined;
      result.route = { cost, ticketsNet: Math.round(R.ROUTE_TICKETS * world.market.tourism) - R.ROUTE_UPKEEP,
        canBuild: !reason, ...(reason ? { reason } : {}) };
    }
    if (!b) {
      const shortfall = Math.max(0, d.price - me.cash);
      const loanNeeded = shortfall <= d.price * R.BUSINESS_LOAN_SHARE ? shortfall : null;
      const hypothetical = { ...a, businesses: [...a.businesses, { id: d.id, stakes: [{ playerId: me.id, share: 1 }],
        manager: 'owner' as const, damaged: false, builtWeek: world.week }] };
      const preview = structuredClone({ ...world, archipelago: hypothetical });
      if (loanNeeded) addLoan(preview, preview.players[0], loanNeeded, false);
      const gross = grossIncome(preview, hypothetical, hypothetical.businesses[hypothetical.businesses.length - 1]);
      const income = gross - d.upkeep;
      const reason: EngineError | undefined = !route ? { code: 'noRoute' } : count >= R.MAX_HUMAN_BUSINESSES ? { code: 'businessLimit' }
        : loanNeeded === null ? { code: 'notEnoughCash', missing: shortfall - d.price * R.BUSINESS_LOAN_SHARE } : undefined;
      result.buy = { price: d.price, income, paybackWeeks: income > 0 ? Math.ceil(d.price / income) : null,
        freedomAfter: financeView(preview, playerId).freedomRatio, loanNeeded, canBuy: !reason, ...(reason ? { reason } : {}) };
    }
    if (b && share > 0) {
      const managers: Manager[] = ['owner', 'hired', ...world.players.filter((p) => p.isBot && a.routes.some((id) => ISLANDS[id].resident === p.id))
        .map((p) => ({ neighborId: p.id }))];
      const gross = grossIncome(world, a, b);
      const effective = b.manager === 'owner' && a.businesses.filter((x) => x.manager === 'owner').indexOf(b) >= daysAvailable(me) ? 'hired' : b.manager;
      result.own = { share, income: Math.round((gross - managerFee(gross, effective)) * share), upkeep: Math.round(d.upkeep * share),
        value: businessValue(b), repairCost: b.damaged ? repairPrice(b) : 0,
        insured: a.insuredFrom !== null && world.week >= a.insuredFrom,
        managers: share !== 1 ? [] : managers.map((manager) => {
          const reason = managerError(world, b.id, manager);
          return { manager, feeShare: manager === 'owner' ? 0 : manager === 'hired' ? R.HIRED_MANAGER_SHARE : R.NEIGHBOR_MANAGER_SHARE,
            current: JSON.stringify(manager) === JSON.stringify(b.manager), available: !reason, ...(reason ? { reason } : {}) };
        }), partnerId: b.stakes.find((s) => s.playerId !== me.id)?.playerId ?? null };
    }
    result.attention = !!result.route?.canBuild || !!result.buy?.canBuy || !!result.own && result.damaged || !!pending;
    return result;
  });
  const projection = archProjection(world, me);
  return { openWeek: a.openWeek, businesses: { have: count, max: R.MAX_HUMAN_BUSINESSES },
    days: { used: Math.min(daysAvailable(me), a.businesses.filter((b) => b.manager === 'owner').length), total: daysAvailable(me) },
    weeklyNet: projection.income - projection.expenses,
    sets: (Object.keys(SETS) as (keyof typeof SETS)[]).map((id) => {
      const have = SETS[id].filter((id) => a.businesses.some((b) => b.id === id && humanShare(b) > 0)).length;
      return { id, have, total: SETS[id].length, active: have === SETS[id].length };
    }), islands, insurance: { on: a.insuredFrom !== null, activeFrom: a.insuredFrom,
      premium: a.businesses.reduce((n, b) => n + (BUSINESSES[b.id].stormRisk > 0 ? Math.round(R.BUSINESS_INSURANCE_RATE * BUSINESSES[b.id].price * humanShare(b)) : 0), 0) },
    attention: islands.some((i) => i.attention) || !!me.choice && ['partner', 'bankLoan', 'bizBuyer'].includes(me.choice.kind),
    finaleWeek: a.finaleWeek, legacy: { freeNeighbors: world.players.filter((p) => p.isBot && financeView(world, p.id).freedomRatio >= 1).length,
      paidToNeighbors: a.log.paidToNeighbors }, seen: { ...a.seen } };
}
