import type { Policy } from '../../src/bots';
import { weeklyExpenses } from '../../src/economy';
import { rumorViews } from '../../src/engagement';
import { hashString, peekRandom } from '../../src/rng';
import { getPlayer } from '../../src/selectors';
import type { PlayerState, WorldState } from '../../src/types';
import { dreamSavings, makeSensible, startDreamStage } from '../../scripts/policies';
import { BUSINESSES, ISLAND_ORDER, ISLANDS } from './content';
import { daysAvailable, grossIncome, humanShare, network, repairPrice, routeCost } from './model';
import * as R from './rules';
import type { ArchAction, ArchState, BusinessId, IslandId, Manager } from './types';

/** «Рисковый» — всё самое дорогое и в кредит; «Наобум» — случайный игрок, точка отсчёта для «удачи против умения». */
export const STRATEGY_NAMES = ['Домосед', 'Цепочка', 'Везде понемногу', 'Партнёр соседей', 'Рисковый', 'Наобум'] as const;
export type StrategyName = typeof STRATEGY_NAMES[number];
export interface ArchStrategy {
  homePolicy: Policy;
  decide: (world: WorldState, arch: ArchState) => ArchAction | null;
}

type Target = { island: IslandId } | { business: BusinessId };
const route = (island: IslandId): Target => ({ island });
const business = (id: BusinessId): Target => ({ business: id });
const TARGETS: Record<Exclude<StrategyName, 'Рисковый' | 'Наобум'>, Target[]> = {
  'Домосед': [],
  'Цепочка': [route('pelican'), business('cannery'), route('lighthouse'), business('coldStore'),
    route('cedar'), business('shipyard'), route('shell'), business('hotel'), route('big'), business('bank')],
  'Везде понемногу': [route('lighthouse'), route('pelican'), route('shell'), route('cedar'), route('big'),
    business('coldStore'), business('bank'), business('shipyard'), business('cannery'), business('hotel')],
  'Партнёр соседей': [route('shell'), route('pelican'), route('lighthouse'), business('coldStore'),
    route('cedar'), business('shipyard'), route('big'), business('bank'), business('cannery'), business('hotel')],
};

export function buffer(me: PlayerState): number {
  return Math.max(300, 2 * weeklyExpenses(me).total);
}

function price(target: Target, arch: ArchState): number {
  return 'island' in target ? routeCost(arch) : BUSINESSES[target.business].price;
}

function remaining(name: StrategyName, arch: ArchState): Target[] {
  const targets = name === 'Рисковый' || name === 'Наобум' ? [
    ...ISLAND_ORDER.filter((id) => !arch.routes.includes(id)).map(route),
    ...Object.values(BUSINESSES).filter((b) => arch.routes.includes(b.island)).map((b) => business(b.id)),
  ] : TARGETS[name];
  const todo = targets.filter((t) => 'island' in t ? !arch.routes.includes(t.island)
    : !arch.businesses.some((b) => b.id === t.business));
  return name === 'Рисковый' ? todo.sort((a, b) => price(b, arch) - price(a, arch)) : todo;
}

/** Монетка случайного игрока: детерминирована по миру и неделе, состояние ГПСЧ движка не сдвигает. */
function coin(world: WorldState, salt: string): number {
  return peekRandom(world.rng, hashString(`naive:${world.week}:${salt}`));
}

function credit(name: StrategyName, target: Target, world?: WorldState): number {
  // spec: «до 50%» у Цепочки — максимальный разрешённый кредит; Наобум берёт его через раз.
  const max = 'business' in target ? BUSINESSES[target.business].price * R.BUSINESS_LOAN_SHARE : 0;
  if (name === 'Наобум') return world && coin(world, `loan:${'business' in target ? target.business : ''}`) < 0.5 ? max : 0;
  return name === 'Цепочка' || name === 'Рисковый' ? max : 0;
}

function decideChoice(name: StrategyName, world: WorldState, arch: ArchState): ArchAction {
  const choice = arch.choice!;
  const me = getPlayer(world, 'p1');
  let accept = false;
  let loan = 0;
  if (name !== 'Домосед') {
    if (choice.kind === 'partner') {
      const half = BUSINESSES[choice.business].price * R.PARTNER_SHARE;
      const eligible = (name !== 'Цепочка' || choice.business === 'cannery') && (name !== 'Наобум' || coin(world, 'partner') < 0.5);
      loan = name === 'Везде понемногу' ? 0 : half * R.BUSINESS_LOAN_SHARE;
      // spec: «всегда» — согласие, когда половину можно оплатить с общим запасом.
      accept = eligible && me.cash - buffer(me) + loan >= half;
    } else if (choice.kind === 'loanRequest') {
      const crisis = name !== 'Рисковый' && name !== 'Наобум' && choice.borrower === 'npc' && choice.cls !== 'reliable'
        && rumorViews(world, 'p1').some((r) => r.kind === 'crisis' && r.source === 'reliable');
      const eligible = name === 'Рисковый' || (name === 'Наобум' && coin(world, 'loan') < 0.5) || choice.cls === 'reliable'
        || (name === 'Везде понемногу' && choice.cls === 'normal')
        || (name === 'Партнёр соседей' && choice.borrower !== 'npc');
      accept = eligible && !crisis && me.cash - buffer(me) >= choice.amount;
    } else {
      const b = arch.businesses.find((b) => b.id === choice.business)!;
      const gross = grossIncome(world, arch, b);
      const fee = b.manager === 'hired' ? R.HIRED_MANAGER_SHARE : typeof b.manager === 'object' ? R.NEIGHBOR_MANAGER_SHARE : 0;
      const def = BUSINESSES[b.id];
      const premium = arch.insuredFrom !== null && def.stormRisk > 0 ? Math.round(R.BUSINESS_INSURANCE_RATE * def.price) : 0;
      const net = gross - Math.round(gross * fee) - def.upkeep - premium;
      accept = name === 'Рисковый' || (name === 'Наобум' && coin(world, 'buyer') < 0.5)
        || (name === 'Везде понемногу' && choice.offer >= 40 * net);
    }
  }
  return { type: 'resolveChoice', accept, ...(accept && loan > 0 ? { loan } : {}) };
}

function management(name: StrategyName, world: WorldState, arch: ArchState): ArchAction | null {
  if (name === 'Домосед' || name === 'Рисковый' || name === 'Наобум') return null;
  const owned = arch.businesses.filter((b) => humanShare(b) === 1);
  const days = daysAvailable(getPlayer(world, 'p1'));
  const ranked = name === 'Везде понемногу' ? [...owned].sort((a, b) => grossIncome(world, arch, b)
    - grossIncome(world, arch, a)) : owned;
  const self = new Set(ranked.slice(0, name === 'Везде понемногу' ? Math.min(1, days) : days).map((b) => b.id));
  const desired = (id: BusinessId): Manager => {
    if (name !== 'Партнёр соседей') return self.has(id) ? 'owner' : 'hired';
    if (id === 'bank') return days > 0 ? 'owner' : 'hired';
    const neighbors = network(arch);
    const neighbor = neighbors.includes('bot-timur') ? 'bot-timur' : ISLANDS[BUSINESSES[id].island].resident;
    // spec: пока доступного соседа нет, управляет наёмный.
    return neighbor && neighbors.includes(neighbor) ? { neighborId: neighbor } : 'hired';
  };
  // Сначала освобождаем день, потом передаём его самому доходному делу.
  for (const b of [...owned].sort((a, b) => Number(desired(a.id) === 'owner') - Number(desired(b.id) === 'owner'))) {
    const manager = desired(b.id);
    if (JSON.stringify(manager) !== JSON.stringify(b.manager)) return { type: 'setManager', business: b.id, manager };
  }
  return null;
}

export function createStrategy(name: StrategyName, arch: ArchState): ArchStrategy {
  let lastRandomPurchase = -1;
  const homePolicy: Policy = (world, me) => {
    const base = makeSensible({ beforeBuying: startDreamStage, upgradeReserve: (player) => dreamSavings(player)
      + (arch.openWeek !== null ? priceOrZero(remaining(name, arch)[0], arch) : 0) });
    const action = base(world, me);
    if (action) return action;
    if (arch.openWeek !== null && remaining(name, arch).length === 0) {
      const loan = me.loans.find((l) => !l.emergency);
      if (loan && me.cash > buffer(me)) return { type: 'repayLoan', playerId: me.id, loanUid: loan.uid,
        amount: Math.min(loan.principal, me.cash - buffer(me)) };
    }
    return null;
  };
  const decide = (world: WorldState, state: ArchState): ArchAction | null => {
    if (state.openWeek === null) return null;
    const me = getPlayer(world, 'p1');
    const owned = state.businesses.filter((b) => humanShare(b) > 0);
    if (!['Домосед', 'Рисковый', 'Наобум'].includes(name) && owned.length && state.insuredFrom === null) {
      return { type: 'setInsurance', on: true };
    }
    if (state.choice) return decideChoice(name, world, state);
    for (const b of owned) if (b.damaged && (name === 'Рисковый' || name === 'Наобум' ? me.cash >= 2 * repairPrice(b)
      : me.cash - buffer(me) >= repairPrice(b)) && b.stakes.every((s) => s.playerId === 'p1'
        || getPlayer(world, s.playerId).cash >= Math.round(BUSINESSES[b.id].price * R.BUSINESS_REPAIR_SHARE * s.share))) {
      return { type: 'repairBusiness', business: b.id };
    }
    const manager = management(name, world, state);
    if (manager) return manager;
    // spec: «каждую неделю — самое дорогое» означает одну самостоятельную покупку за неделю.
    const once = name === 'Рисковый' || name === 'Наобум';
    if (once && lastRandomPurchase === world.week) return null;
    // Наобум покупает через неделю что-нибудь из того, что по карману.
    if (name === 'Наобум' && coin(world, 'buy') >= 0.5) return null;
    const todo = remaining(name, state);
    const fits = (t: Target) => me.cash - buffer(me) + credit(name, t, world) >= price(t, state);
    const affordable = todo.filter(fits);
    const target = name === 'Рисковый' ? affordable[0]
      : name === 'Наобум' ? affordable[Math.floor(coin(world, 'pick') * affordable.length)] : todo[0];
    if (!target || !fits(target)) return null;
    if (once) lastRandomPurchase = world.week;
    return 'island' in target ? { type: 'buildRoute', island: target.island }
      : { type: 'buyBusiness', business: target.business, loan: credit(name, target, world) };
  };
  return { homePolicy, decide };
}

function priceOrZero(target: Target | undefined, arch: ArchState): number {
  return target ? price(target, arch) : 0;
}
