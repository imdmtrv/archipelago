// Слой меняет только переданные ему мир и состояние; случайность мира ему не нужна.
import { addLoan } from '../../src/actions';
import { realFreedomRatio } from '../../src/economy';
import { hashString, Rng } from '../../src/rng';
import { INCOME_BONUS, INCOME_BONUS_KNOWLEDGE, INSURANCE_WAIT_WEEKS } from '../../src/rules';
import { getPlayer } from '../../src/selectors';
import type { OwnedAsset, PlayerState, WorldState } from '../../src/types';
import { BUSINESSES, ISLANDS, ISLAND_ORDER, SETS } from './content';
import * as R from './rules';
import type { ArchAction, ArchState, BankClass, BusinessId, BusinessState, IslandId, Manager } from './types';

export function createArch(seed: number): ArchState {
  return {
    openWeek: null, routes: [], businesses: [], loans: [], insuredFrom: null,
    choice: null, mainlandFrom: null, finaleWeek: null, rng: hashString(`arch:${seed}`), nextUid: 1, syncedShares: [],
    log: { decisionWeeks: [], homeDecisionWeeks: [], paidToNeighbors: 0, bankLent: 0, bankDefaulted: 0,
      bankInterest: 0, repairs: 0, businessIncome: 0, restoredShares: 0 },
  };
}

export function network(arch: ArchState): string[] {
  return ['p1', ...arch.routes.flatMap((id) => ISLANDS[id].resident ? [ISLANDS[id].resident!] : [])];
}

export function reach(arch: ArchState, island: IslandId): string[] {
  return arch.routes.includes(island) ? network(arch) : ISLANDS[island].resident ? [ISLANDS[island].resident!] : [];
}

export function humanShare(business: BusinessState): number {
  return business.stakes.find((s) => s.playerId === 'p1')?.share ?? 0;
}

export function humanBusinessCount(arch: ArchState): number {
  return arch.businesses.filter((b) => humanShare(b) > 0).length;
}

export function activeSets(arch: ArchState): (keyof typeof SETS)[] {
  return (Object.keys(SETS) as (keyof typeof SETS)[]).filter((set) => SETS[set]
    .every((id) => arch.businesses.some((b) => b.id === id && humanShare(b) > 0)));
}

export function daysAvailable(player: PlayerState): number {
  return player.dream?.building ? 0 : player.employed ? R.DAYS_EMPLOYED : R.DAYS_FREE;
}

function intact(arch: ArchState, id: BusinessId): boolean {
  return arch.businesses.some((b) => b.id === id && !b.damaged);
}

export function routeCost(arch: ArchState): number {
  return Math.round(R.ROUTE_COST * (intact(arch, 'shipyard') ? 1 - R.SHIPYARD_ROUTE_DISCOUNT : 1));
}

export function businessValue(business: BusinessState, playerId = 'p1'): number {
  const def = BUSINESSES[business.id];
  const share = business.stakes.find((s) => s.playerId === playerId)?.share ?? 0;
  return Math.round(def.price * share * (def.resaleRate - (business.damaged ? R.BUSINESS_REPAIR_SHARE : 0)));
}

export function grossIncome(world: WorldState, arch: ArchState, business: BusinessState): number {
  if (business.damaged) return 0;
  const def = BUSINESSES[business.id];
  let gross: number;
  switch (business.id) {
    case 'cannery': {
      const boats = reach(arch, 'pelican').reduce((sum, id) => sum + getPlayer(world, id).owned
        .filter((a) => a.defId === 'boat' && !a.damaged).length, 0);
      // Склад и завод вместе: холодильник хранит улов для завода, и завод не простаивает в дешёвую рыбу.
      const stored = intact(arch, 'coldStore') && arch.routes.includes('lighthouse') && arch.routes.includes('pelican');
      const fish = stored ? Math.max(world.market.fish, R.COLD_STORE_FISH_FLOOR) : world.market.fish;
      gross = Math.round(def.baseIncome * fish + R.CANNERY_PER_BOAT * boats);
      break;
    }
    case 'hotel': gross = Math.round(def.baseIncome * world.market.tourism
      * (1 + R.HOTEL_PER_ISLAND * reach(arch, 'shell').length)); break;
    case 'shipyard': gross = Math.round(def.baseIncome + R.SHIPYARD_PER_ROUTE * arch.routes.length); break;
    default: gross = def.baseIncome;
  }
  // spec: бонус умножает уже округлённый доход первой итерации; результат снова округляется до монет.
  return activeSets(arch).some((set) => SETS[set].includes(business.id)) ? Math.round(gross * (1 + R.SET_BONUS)) : gross;
}

function managerFee(gross: number, manager: Manager): number {
  return Math.round(gross * (manager === 'hired' ? R.HIRED_MANAGER_SHARE
    : typeof manager === 'object' ? R.NEIGHBOR_MANAGER_SHARE : 0));
}

export function repairPrice(business: BusinessState): number {
  return Math.round(BUSINESSES[business.id].price * R.BUSINESS_REPAIR_SHARE * humanShare(business));
}

function requireAction(valid: boolean, reason: string): asserts valid {
  if (!valid) throw new Error(`Архипелаг: ${reason}`);
}

function fund(world: WorldState, price: number, loan: number, limit: number): void {
  const me = getPlayer(world, 'p1');
  requireAction(Number.isFinite(loan) && loan >= 0 && loan <= limit, 'недопустимый кредит');
  requireAction(me.cash + loan >= price, 'не хватает наличных');
  if (loan > 0) addLoan(world, me, loan, false);
  me.cash += loan - price;
}

function build(arch: ArchState, id: BusinessId, week: number, botId?: string, partner = false): void {
  arch.businesses.push({ id, damaged: false, builtWeek: week, manager: botId ? 'partner' : 'owner',
    stakes: botId ? partner ? [{ playerId: 'p1', share: R.PARTNER_SHARE },
      { playerId: botId, share: 1 - R.PARTNER_SHARE }] : [{ playerId: botId, share: 1 }]
      : [{ playerId: 'p1', share: 1 }] });
}

function resolveChoice(world: WorldState, arch: ArchState, accept: boolean, loan = 0): void {
  const choice = arch.choice;
  requireAction(choice !== null, 'нет развилки');
  const me = getPlayer(world, 'p1');
  if (choice.kind === 'partner') {
    const def = BUSINESSES[choice.business];
    const bot = getPlayer(world, choice.botId);
    requireAction(!arch.businesses.some((b) => b.id === choice.business), 'дело уже построено');
    if (accept) {
      requireAction(humanBusinessCount(arch) < R.MAX_HUMAN_BUSINESSES, 'достигнут предел дел человека');
      requireAction(bot.cash >= def.price * (1 - R.PARTNER_SHARE), 'партнёру не хватает денег');
      fund(world, def.price * R.PARTNER_SHARE, loan, def.price * R.PARTNER_SHARE * R.BUSINESS_LOAN_SHARE);
      bot.cash -= def.price * (1 - R.PARTNER_SHARE);
      build(arch, choice.business, world.week, bot.id, true);
    } else if (bot.cash >= def.price + R.BOT_BUFFER[bot.id]) {
      bot.cash -= def.price;
      build(arch, choice.business, world.week, bot.id);
    }
  } else if (accept && choice.kind === 'loanRequest') {
    requireAction(loan === 0 && me.cash >= choice.amount, 'не хватает денег на заём');
    me.cash -= choice.amount;
    if (choice.borrower !== 'npc') getPlayer(world, choice.borrower).cash += choice.amount;
    arch.loans.push({ uid: `arch-loan-${arch.nextUid++}`, borrower: choice.borrower, cls: choice.cls,
      principal: choice.amount, weeklyRate: choice.weeklyRate, startWeek: world.week,
      dueWeek: world.week + choice.term, tries: 0, crisisSeen: false });
    arch.log.bankLent += choice.amount;
  } else if (accept && choice.kind === 'buyer') {
    const business = arch.businesses.find((b) => b.id === choice.business);
    requireAction(!!business && humanShare(business) === 1, 'нет целого дела для продажи');
    me.cash += choice.offer;
    business.stakes = [{ playerId: 'mainland', share: 1 }];
    business.manager = 'partner';
  }
  arch.choice = null;
}

export function applyArchAction(world: WorldState, arch: ArchState, action: ArchAction): void {
  requireAction(arch.openWeek !== null, 'архипелаг закрыт');
  const me = getPlayer(world, 'p1');
  switch (action.type) {
    case 'buildRoute':
      requireAction(!!ISLANDS[action.island] && !arch.routes.includes(action.island), 'линия уже есть или остров неизвестен');
      fund(world, routeCost(arch), 0, 0);
      arch.routes.push(action.island);
      break;
    case 'buyBusiness': {
      const def = BUSINESSES[action.business];
      requireAction(!!def && arch.routes.includes(def.island), 'остров не в сети');
      requireAction(!arch.businesses.some((b) => b.id === action.business), 'дело уже построено');
      requireAction(humanBusinessCount(arch) < R.MAX_HUMAN_BUSINESSES, 'достигнут предел дел человека');
      fund(world, def.price, action.loan, def.price * R.BUSINESS_LOAN_SHARE);
      build(arch, action.business, world.week);
      // Купил сам, пока сосед ждал ответа, — предложение войти в долю снимается.
      if (arch.choice?.kind === 'partner' && arch.choice.business === action.business) arch.choice = null;
      break;
    }
    case 'setManager': {
      const business = arch.businesses.find((b) => b.id === action.business);
      requireAction(!!business && humanShare(business) === 1, 'управление только целым своим делом');
      requireAction(action.manager !== 'partner', 'партнёра нельзя нанять');
      if (action.manager === 'owner') requireAction(arch.businesses
        .filter((b) => b.id !== business.id && b.manager === 'owner').length < daysAvailable(me), 'нет свободного дня');
      if (typeof action.manager === 'object') requireAction(action.manager.neighborId !== 'p1'
        && network(arch).includes(action.manager.neighborId), 'сосед вне сети');
      business.manager = action.manager;
      break;
    }
    case 'repairBusiness': {
      const business = arch.businesses.find((b) => b.id === action.business);
      requireAction(!!business && humanShare(business) > 0 && business.damaged, 'нет повреждённого своего дела');
      const costs = business.stakes.map((s) => ({ player: getPlayer(world, s.playerId),
        amount: Math.round(BUSINESSES[business.id].price * R.BUSINESS_REPAIR_SHARE * s.share) }));
      requireAction(costs.every((c) => c.player.cash >= c.amount), 'не хватает денег на ремонт долей');
      for (const c of costs) c.player.cash -= c.amount;
      arch.log.repairs += repairPrice(business);
      business.damaged = false;
      break;
    }
    case 'setInsurance':
      if (action.on && arch.insuredFrom === null) arch.insuredFrom = world.week + INSURANCE_WAIT_WEEKS;
      if (!action.on) arch.insuredFrom = null;
      break;
    case 'resolveChoice': resolveChoice(world, arch, action.accept, action.loan); break;
  }
  arch.log.decisionWeeks.push(world.week);
}

function pseudo(player: PlayerState, uid: string, income: number, upkeep: number, week: number, slot: number): OwnedAsset {
  return { uid, defId: 'deposit', price: 0, income: Math.round(income
    / (player.knowledge >= INCOME_BONUS_KNOWLEDGE ? 1 + INCOME_BONUS : 1)), upkeep,
  damaged: false, level: 1, slotIndex: 1000 + slot, boughtWeek: week };
}

export function syncShares(world: WorldState, arch: ArchState): void {
  if (arch.openWeek === null) return;
  let days = daysAvailable(getPlayer(world, 'p1'));
  for (const b of arch.businesses) if (b.manager === 'owner' && days-- <= 0) b.manager = 'hired';
  for (const player of world.players) player.owned = player.owned.filter((a) => !a.uid.startsWith('arch-'));
  arch.syncedShares = [];
  const put = (playerId: string, uid: string, income: number, upkeep = 0) => {
    if (playerId === 'mainland') return;
    const player = getPlayer(world, playerId);
    const asset = pseudo(player, uid, income, upkeep, world.week, arch.syncedShares.length);
    player.owned.push(asset);
    arch.syncedShares.push({ playerId, asset: { ...asset } });
  };
  for (const b of arch.businesses) {
    const def = BUSINESSES[b.id];
    const gross = grossIncome(world, arch, b);
    const fee = managerFee(gross, b.manager);
    if (typeof b.manager === 'object') put(b.manager.neighborId, `arch-mgr-${b.id}`, fee);
    for (const s of b.stakes) {
      const premium = s.playerId === 'p1' && arch.insuredFrom !== null && def.stormRisk > 0
        ? Math.round(R.BUSINESS_INSURANCE_RATE * def.price * s.share) : 0;
      put(s.playerId, `arch-biz-${b.id}`, Math.round(s.share * (gross - fee)), Math.round(s.share * def.upkeep) + premium);
    }
  }
  for (const player of world.players) {
    const base = player.owned.filter((a) => !a.damaged && (a.defId === 'boat' || a.defId === 'smokehouse'))
      .reduce((sum, a) => sum + a.income, 0);
    const eff = intact(arch, 'coldStore') && reach(arch, 'lighthouse').includes(player.id)
      ? Math.max(world.market.fish, R.COLD_STORE_FISH_FLOOR) : world.market.fish;
    const bonus = intact(arch, 'cannery') && reach(arch, 'pelican').includes(player.id) ? R.CANNERY_FISH_BONUS : 0;
    const extra = Math.round(base * (eff * (1 + bonus) - world.market.fish));
    if (extra !== 0) put(player.id, 'arch-fish', extra);
  }
  if (arch.routes.length) put('p1', 'arch-routes', Math.round(R.ROUTE_TICKETS * world.market.tourism * arch.routes.length),
    R.ROUTE_UPKEEP * arch.routes.length);
  const interest = arch.loans.filter((l) => l.borrower === 'npc' && l.startWeek <= world.week && l.dueWeek >= world.week)
    .reduce((sum, l) => sum + Math.round(l.principal * l.weeklyRate), 0);
  if (interest) put('p1', 'arch-bank', interest);
}

function settleLoans(world: WorldState, arch: ArchState, week: number, rng: Rng): void {
  const me = getPlayer(world, 'p1');
  arch.loans = arch.loans.filter((loan) => {
    if (loan.dueWeek > week) return true;
    if (loan.borrower === 'npc') {
      if (rng.chance(Math.min(0.95, R.BANK_DEFAULT[loan.cls] * (loan.crisisSeen ? R.CRISIS_DEFAULT_MULT : 1)))) {
        arch.log.bankDefaulted += loan.principal;
      } else me.cash += loan.principal;
    } else {
      // spec: отсрочки не удлиняют процентный срок; проценты начислены за первоначальный договор.
      const term = loan.dueWeek - loan.startWeek - loan.tries * R.NEIGHBOR_LOAN_RETRY;
      const interest = Math.round(loan.principal * loan.weeklyRate * term);
      const bot = getPlayer(world, loan.borrower);
      if (bot.cash >= loan.principal + interest) {
        bot.cash -= loan.principal + interest;
        me.cash += loan.principal + interest;
        arch.log.bankInterest += interest;
      } else if (++loan.tries < R.NEIGHBOR_LOAN_TRIES) {
        loan.dueWeek += R.NEIGHBOR_LOAN_RETRY;
        return true;
      } else arch.log.bankDefaulted += loan.principal;
    }
    return false;
  });
}

function nextChoice(world: WorldState, arch: ArchState, week: number, rng: Rng): void {
  if (arch.openWeek === null || arch.choice) return;
  for (const [botId, business] of Object.entries(R.BOT_BUILDS)) {
    if (week >= arch.openWeek + R.BOT_DELAY && !arch.businesses.some((b) => b.id === business)
      && getPlayer(world, botId).cash >= BUSINESSES[business].price + R.BOT_BUFFER[botId]) {
      arch.choice = { kind: 'partner', week: world.week, botId, business };
      return;
    }
  }
  if (arch.businesses.some((b) => b.id === 'bank' && !b.damaged && humanShare(b) === 1) && rng.chance(R.BANK_REQUEST_CHANCE)) {
    const needy = network(arch).filter((id) => id !== 'p1' && (getPlayer(world, id).cash < R.NEIGHBOR_NEED_CASH
      || getPlayer(world, id).loans.some((l) => l.emergency)));
    const borrower = needy.length && rng.chance(R.BANK_NEIGHBOR_SHARE) ? needy[rng.int(0, needy.length - 1)] : 'npc';
    const classes: Record<string, BankClass> = { 'bot-mia': 'reliable', 'bot-timur': 'normal', 'bot-boris': 'risky' };
    const cls = borrower === 'npc' ? rng.weighted(R.BANK_CLASS_WEIGHTS) : classes[borrower];
    const amount = borrower === 'npc' ? Math.round(rng.range(...R.BANK_AMOUNT) / 100) * 100
      : Math.max(R.BANK_AMOUNT[0], Math.min(R.BANK_AMOUNT[1], Math.ceil((getPlayer(world, borrower).loans
        .filter((l) => l.emergency).reduce((sum, l) => sum + l.principal, 0) + 500) / 100) * 100));
    arch.choice = { kind: 'loanRequest', week: world.week, borrower, cls, amount,
      weeklyRate: R.BANK_RATE[cls], term: rng.int(...R.BANK_TERM) };
    return;
  }
  for (const b of arch.businesses) if (humanShare(b) === 1 && rng.chance(R.BUYER_CHANCE)) {
    arch.choice = { kind: 'buyer', week: world.week, business: b.id,
      offer: Math.round(BUSINESSES[b.id].price * rng.range(...R.BUYER_PREMIUM)) };
    return;
  }
}

export function settleArch(world: WorldState, arch: ArchState): void {
  const report = world.lastReport;
  if (!report) return;
  const week = report.week;
  const me = getPlayer(world, 'p1');
  const rng = new Rng(arch.rng);
  // 5.1: возвращаем точный снимок, не пересчитывая его по рынку следующей недели.
  for (const { playerId, asset } of arch.syncedShares) {
    const player = getPlayer(world, playerId);
    if (!player.owned.some((a) => a.uid === asset.uid)) {
      player.owned.push({ ...asset });
      arch.log.restoredShares++;
    }
  }
  for (const [id, p] of Object.entries(report.players)) {
    for (const income of p.assetIncome) {
      if (id === 'p1' && income.assetUid === 'arch-bank') arch.log.bankInterest += income.amount;
      if (income.assetUid.startsWith('arch-biz-') || income.assetUid.startsWith('arch-mgr-')) {
        const shared = arch.businesses.some((b) => `arch-biz-${b.id}` === income.assetUid && humanShare(b) > 0);
        if (id !== 'p1' && (shared || income.assetUid.startsWith('arch-mgr-'))) arch.log.paidToNeighbors += income.amount;
        if (id === 'p1') arch.log.businessIncome += income.amount - (p.upkeep.find((u) => u.assetUid === income.assetUid)?.amount ?? 0);
      }
    }
  }
  // 5.2: дни были распределены до расчёта недели.
  if (arch.openWeek !== null) me.happiness = Math.max(0, Math.min(100, me.happiness
    + R.OWNER_DAY_JOY * arch.businesses.filter((b) => b.manager === 'owner').length));
  // 5.3: боты чинят старые повреждения, затем приходит новый шторм.
  for (const b of arch.businesses) if (b.damaged && humanShare(b) === 0 && b.stakes[0].playerId !== 'mainland') {
    const bot = getPlayer(world, b.stakes[0].playerId);
    const price = Math.round(BUSINESSES[b.id].price * R.BUSINESS_REPAIR_SHARE);
    if (bot.cash >= price) { bot.cash -= price; b.damaged = false; }
  }
  if (arch.openWeek !== null && report.worldEvents.some((e) => e.id === 'storm')) {
    const island = ISLAND_ORDER[rng.int(0, ISLAND_ORDER.length - 1)];
    const business = arch.businesses.find((b) => BUSINESSES[b.id].island === island);
    if (business && !business.damaged && rng.chance(Math.min(R.STORM_HIT_MAX, BUSINESSES[business.id].stormRisk * R.STORM_HIT_MULT))) {
      business.damaged = !(humanShare(business) > 0 && arch.insuredFrom !== null && week >= arch.insuredFrom);
    }
    const yard = arch.businesses.find((b) => b.id === 'shipyard' && !b.damaged);
    if (yard) {
      const repairs = reach(arch, 'cedar').reduce((sum, id) => sum + (report.players[id]?.events
        .filter((e) => e.id === 'stormDamage').reduce((n, e) => n + (e.affectedAssetUids?.length ?? 0), 0) ?? 0), 0);
      for (const s of yard.stakes) if (s.playerId !== 'mainland') {
        const amount = Math.round(R.SHIPYARD_PER_REPAIR * repairs * s.share);
        getPlayer(world, s.playerId).cash += amount;
        if (s.playerId === 'p1') arch.log.businessIncome += amount;
        else arch.log.paidToNeighbors += amount;
      }
    }
  }
  // 5.4–5.5: кризис влияет и на займы, заканчивающиеся сейчас.
  if (report.worldEvents.some((e) => e.id === 'crisis')) for (const loan of arch.loans) loan.crisisSeen = true;
  settleLoans(world, arch, week, rng);
  // 5.6: week развилки — неделя ответа, как в движке; предложение соседа ждёт PARTNER_WAIT_WEEKS недель.
  const wait = arch.choice?.kind === 'partner' ? R.PARTNER_WAIT_WEEKS - 1 : 0;
  if (arch.choice && arch.choice.week + wait <= week) resolveChoice(world, arch, false);
  // 5.7: открытие архипелага.
  if (arch.openWeek === null && realFreedomRatio(me, world.market) >= R.OPEN_RATIO) arch.openWeek = week;
  // 5.8а: материк строит до новых развилок, не забирая деньги и не сдвигая ГПСЧ.
  if (arch.openWeek !== null) {
    if (arch.mainlandFrom === null && (humanBusinessCount(arch) >= R.MAX_HUMAN_BUSINESSES
      || week >= arch.openWeek + R.MAINLAND_FALLBACK)) arch.mainlandFrom = week;
    if (arch.mainlandFrom !== null && week >= arch.mainlandFrom && (week - arch.mainlandFrom) % R.MAINLAND_STEP === 0) {
      const next = Object.values(BUSINESSES).filter((def) => !arch.businesses.some((b) => b.id === def.id))
        .sort((a, b) => a.price - b.price)[0];
      if (next) {
        build(arch, next.id, week, 'mainland');
        if (arch.choice?.kind === 'partner' && arch.choice.business === next.id) arch.choice = null;
      }
    }
  }
  // 5.8–5.9: развилки и финал.
  nextChoice(world, arch, week, rng);
  if (arch.finaleWeek === null && arch.routes.length === ISLAND_ORDER.length
    && arch.businesses.length === ISLAND_ORDER.length) arch.finaleWeek = week;
  arch.rng = rng.state;
}
