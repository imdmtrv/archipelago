import { describe, expect, it } from 'vitest';
import { runBotTurn } from '../src/bots';
import { currentIncome } from '../src/economy';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import { INCOME_BONUS_KNOWLEDGE } from '../src/rules';
import { getPlayer } from '../src/selectors';
import type { OwnedAsset, WorldState } from '../src/types';
import { createWorld } from '../src/world';
import { badNumbers, runGame } from '../scripts/archipelago';
import { BUSINESSES, ISLAND_ORDER, SETS } from '../proto/archipelago/content';
import { activeSets, applyArchAction, createArch, grossIncome, humanBusinessCount, reach, routeCost, settleArch, syncShares } from '../proto/archipelago/model';
import * as R from '../proto/archipelago/rules';
import { createStrategy, STRATEGY_NAMES } from '../proto/archipelago/strategies';
import type { BusinessId, BusinessState } from '../proto/archipelago/types';

function setup() {
  const world = createWorld({ seed: 17, playerName: 'Игрок', islandName: 'Тест', profession: 'teacher' });
  const arch = createArch(17);
  arch.openWeek = 0;
  world.players[0].cash = 50000;
  return { world, arch };
}

function built(id: BusinessId, playerId = 'p1'): BusinessState {
  return { id, stakes: [{ playerId, share: 1 }], damaged: false, builtWeek: 1, manager: 'hired' };
}

function report(world: WorldState, storm = false): void {
  world.lastReport = { week: world.week, worldEvents: storm ? [{ id: 'storm', tone: 'bad' }] : [], players: {}, news: [] };
  world.week++;
}

function rngState(predicate: (rng: Rng) => boolean): number {
  for (let state = 0; state < 10000; state++) if (predicate(new Rng(state))) return state;
  throw new Error('Не найдено состояние ГПСЧ');
}

describe('Прототип архипелага', () => {
  it('полностью воспроизводит мир и слой на одном сиде', () => {
    expect(runGame(5, 160, 'Цепочка')).toEqual(runGame(5, 160, 'Цепочка'));
  });

  it('до открытия совпадает с обычной игрой при той же домашней политике', () => {
    for (const name of STRATEGY_NAMES) {
      let world = createWorld({ seed: 9, playerName: 'Игрок', islandName: 'Тест', profession: 'teacher' });
      let plain = structuredClone(world);
      const arch = createArch(9);
      const strategy = createStrategy(name, arch);
      const plainPolicy = createStrategy(name, createArch(9)).homePolicy;
      for (let w = 0; w < 160 && arch.openWeek === null; w++) {
        const turn = runBotTurn(world, 'p1', strategy.homePolicy);
        const other = runBotTurn(plain, 'p1', plainPolicy);
        expect(turn.errors).toEqual([]);
        expect(other.errors).toEqual([]);
        world = turn.world;
        expect(strategy.decide(world, arch)).toBeNull();
        syncShares(world, arch);
        world = applyAction(world, { type: 'endWeek' }).world;
        plain = applyAction(other.world, { type: 'endWeek' }).world;
        settleArch(world, arch);
        expect(world).toEqual(plain);
      }
      expect(arch.openWeek).not.toBeNull();
    }
  });

  it('скидка на линии действует только с целой верфью', () => {
    const { world, arch } = setup();
    expect(routeCost(arch)).toBe(R.ROUTE_COST);
    const yard = built('shipyard');
    arch.businesses.push(yard);
    expect(routeCost(arch)).toBe(Math.round(R.ROUTE_COST * (1 - R.SHIPYARD_ROUTE_DISCOUNT)));
    const before = world.players[0].cash;
    applyArchAction(world, arch, { type: 'buildRoute', island: 'shell' });
    expect(before - world.players[0].cash).toBe(routeCost(arch));
    yard.damaged = true;
    expect(routeCost(arch)).toBe(R.ROUTE_COST);
  });

  it('партнёры платят половину цены и получают половину дохода', () => {
    const { world, arch } = setup();
    const bot = getPlayer(world, 'bot-mia');
    bot.cash = 20000;
    arch.choice = { kind: 'partner', week: 1, business: 'hotel', botId: bot.id };
    const before = [world.players[0].cash, bot.cash];
    applyArchAction(world, arch, { type: 'resolveChoice', accept: true });
    expect([before[0] - world.players[0].cash, before[1] - bot.cash]).toEqual([5000, 5000]);
    const gross = grossIncome(world, arch, arch.businesses[0]);
    syncShares(world, arch);
    for (const p of [world.players[0], bot]) {
      const share = p.owned.find((a) => a.uid === 'arch-biz-hotel')!;
      expect(currentIncome(share, world.market, p.knowledge)).toBe(Math.round(gross / 2));
      expect(share.upkeep).toBe(BUSINESSES.hotel.upkeep / 2);
    }
    expect(arch.businesses[0].manager).toBe('partner');
  });

  it('четвёртое дело и партнёрство при трёх делах запрещены, продажа освобождает место', () => {
    const { world, arch } = setup();
    arch.routes = [...ISLAND_ORDER];
    arch.insuredFrom = 0;
    const shared = built('cannery');
    shared.stakes = [{ playerId: 'p1', share: R.PARTNER_SHARE }, { playerId: 'bot-boris', share: 1 - R.PARTNER_SHARE }];
    shared.manager = 'partner';
    arch.businesses = [shared, built('coldStore'), built('shipyard')];
    expect(humanBusinessCount(arch)).toBe(R.MAX_HUMAN_BUSINESSES);
    const before = structuredClone({ world, arch });
    expect(() => applyArchAction(world, arch, { type: 'buyBusiness', business: 'bank', loan: 0 })).toThrow('предел');
    expect({ world, arch }).toEqual(before);
    getPlayer(world, 'bot-mia').cash = 20000;
    arch.choice = { kind: 'partner', week: world.week, business: 'hotel', botId: 'bot-mia' };
    const offered = structuredClone({ world, arch });
    expect(() => applyArchAction(world, arch, { type: 'resolveChoice', accept: true })).toThrow('предел');
    expect({ world, arch }).toEqual(offered);
    for (const name of STRATEGY_NAMES) {
      expect(createStrategy(name, arch).decide(world, arch)).toEqual({ type: 'resolveChoice', accept: false });
    }
    applyArchAction(world, arch, { type: 'resolveChoice', accept: false });
    expect(humanBusinessCount(arch)).toBe(R.MAX_HUMAN_BUSINESSES);
    arch.choice = { kind: 'buyer', week: world.week, business: 'coldStore', offer: BUSINESSES.coldStore.price };
    applyArchAction(world, arch, { type: 'resolveChoice', accept: true });
    expect(humanBusinessCount(arch)).toBe(R.MAX_HUMAN_BUSINESSES - 1);
    applyArchAction(world, arch, { type: 'buyBusiness', business: 'bank', loan: 0 });
    expect(humanBusinessCount(arch)).toBe(R.MAX_HUMAN_BUSINESSES);
  });

  it('бонус набора требует все три доли и начисляется до платы управляющему', () => {
    for (const set of Object.keys(SETS) as (keyof typeof SETS)[]) {
      const { world, arch } = setup();
      arch.routes = [...ISLAND_ORDER];
      const members = SETS[set].map((id) => built(id));
      members[0].stakes = [{ playerId: 'p1', share: R.PARTNER_SHARE }, { playerId: 'bot-boris', share: 1 - R.PARTNER_SHARE }];
      arch.businesses = members.slice(0, 2);
      const base = members.map((b) => grossIncome(world, arch, b));
      expect(activeSets(arch)).toEqual([]);
      expect(grossIncome(world, arch, members[0])).toBe(base[0]);
      arch.businesses.push(members[2]);
      expect(activeSets(arch)).toEqual([set]);
      for (const [i, b] of members.entries()) expect(grossIncome(world, arch, b)).toBe(Math.round(base[i] * (1 + R.SET_BONUS)));
      const outside = built(set === 'fishing' ? 'hotel' : 'coldStore');
      expect(grossIncome(world, arch, outside)).toBe(outside.id === 'hotel'
        ? Math.round(BUSINESSES.hotel.baseIncome * world.market.tourism * (1 + R.HOTEL_PER_ISLAND * reach(arch, 'shell').length))
        : BUSINESSES.coldStore.baseIncome);
      world.players[0].knowledge = 0;
      syncShares(world, arch);
      const gross = Math.round(base[0] * (1 + R.SET_BONUS));
      expect(world.players[0].owned.find((a) => a.uid === `arch-biz-${members[0].id}`)!.income)
        .toBe(Math.round(R.PARTNER_SHARE * (gross - Math.round(gross * R.HIRED_MANAGER_SHARE))));
      members[1].damaged = true;
      expect(activeSets(arch)).toEqual([set]);
      expect(grossIncome(world, arch, members[1])).toBe(0);
      expect(grossIncome(world, arch, members[0])).toBe(gross);
      members[2].stakes = [{ playerId: 'mainland', share: 1 }];
      expect(activeSets(arch)).toEqual([]);
      expect(grossIncome(world, arch, members[0])).toBe(base[0]);
    }
  });

  it('материк начинает при трёх делах или по сроку и строит самое дешёвое раз в MAINLAND_STEP недель', () => {
    const { world, arch } = setup();
    expect(arch.mainlandFrom).toBeNull();
    arch.businesses = [built('hotel'), built('cannery')];
    report(world);
    settleArch(world, arch);
    expect(arch.mainlandFrom).toBeNull();
    arch.businesses.push(built('shipyard'));
    arch.choice = { kind: 'partner', week: world.week + 1, business: 'coldStore', botId: 'bot-timur' };
    const start = world.week;
    const cash = world.players.map((p) => p.cash);
    report(world);
    settleArch(world, arch);
    expect(arch.mainlandFrom).toBe(start);
    expect(arch.choice?.kind).not.toBe('partner');
    expect(arch.businesses[3]).toEqual({ id: 'coldStore', damaged: false, builtWeek: start,
      stakes: [{ playerId: 'mainland', share: 1 }], manager: 'partner' });
    for (let step = 1; step <= R.MAINLAND_STEP; step++) {
      report(world);
      settleArch(world, arch);
      expect(arch.businesses).toHaveLength(step === R.MAINLAND_STEP ? 5 : 4);
    }
    expect(arch.businesses[4]).toEqual({ id: 'bank', damaged: false, builtWeek: start + R.MAINLAND_STEP,
      stakes: [{ playerId: 'mainland', share: 1 }], manager: 'partner' });
    expect(world.players.map((p) => p.cash)).toEqual(cash);
    syncShares(world, arch);
    expect(world.players.flatMap((p) => p.owned).some((a) => a.uid === 'arch-biz-coldStore' || a.uid === 'arch-biz-bank')).toBe(false);
    expect(routeCost(arch)).toBe(Math.round(R.ROUTE_COST * (1 - R.SHIPYARD_ROUTE_DISCOUNT)));
    const fallback = setup();
    fallback.world.week = fallback.arch.openWeek! + R.MAINLAND_FALLBACK - 1;
    report(fallback.world);
    settleArch(fallback.world, fallback.arch);
    expect(fallback.arch.mainlandFrom).toBeNull();
    report(fallback.world);
    settleArch(fallback.world, fallback.arch);
    expect(fallback.arch.mainlandFrom).toBe(fallback.arch.openWeek! + R.MAINLAND_FALLBACK);
    expect(fallback.arch.businesses.map((b) => b.id)).toEqual(['coldStore']);
  });

  it('шторм ломает только дело выбранного острова и не трогает ГПСЧ мира', () => {
    const { world, arch } = setup();
    arch.businesses = Object.keys(BUSINESSES).map((id) => built(id as BusinessId));
    arch.rng = rngState((rng) => ISLAND_ORDER[rng.int(0, 4)] === 'shell'
      && rng.chance(Math.min(R.STORM_HIT_MAX, BUSINESSES.hotel.stormRisk * R.STORM_HIT_MULT)));
    const worldRng = world.rng;
    syncShares(world, arch);
    report(world, true);
    settleArch(world, arch);
    expect(arch.businesses.filter((b) => b.damaged).map((b) => b.id)).toEqual(['hotel']);
    expect(world.rng).toBe(worldRng);
  });

  it('банк учитывает проценты приезжего и возврат либо потерю основного долга', () => {
    for (const defaults of [false, true]) {
      let { world, arch } = setup();
      arch.businesses.push(built('bank'));
      arch.choice = { kind: 'loanRequest', week: 1, borrower: 'npc', cls: 'reliable',
        amount: 2000, weeklyRate: R.BANK_RATE.reliable, term: 1 };
      applyArchAction(world, arch, { type: 'resolveChoice', accept: true });
      expect(arch.log.bankLent).toBe(2000);
      expect(world.players[0].cash).toBe(48000);
      arch.loans[0].dueWeek = world.week;
      arch.rng = rngState((rng) => rng.chance(R.BANK_DEFAULT.reliable) === defaults);
      world.upcoming = [];
      syncShares(world, arch);
      world = applyAction(world, { type: 'endWeek' }).world;
      const before = world.players[0].cash;
      settleArch(world, arch);
      expect(world.players[0].cash - before).toBe(defaults ? 0 : 2000);
      expect(arch.loans).toEqual([]);
      expect(arch.log.bankDefaulted).toBe(defaults ? 2000 : 0);
      expect(arch.log.bankInterest).toBe(Math.round(2000 * R.BANK_RATE.reliable));
    }
  });

  it('бонус завода получают только игроки охвата Пеликана, без лишнего бонуса знаний', () => {
    const { world, arch } = setup();
    const boat: OwnedAsset = { uid: 'test-boat', defId: 'boat', boughtWeek: 1, price: 1000,
      income: 100, upkeep: 10, damaged: false, slotIndex: 0, level: 1 };
    for (const p of world.players) { p.owned = [{ ...boat }]; p.knowledge = INCOME_BONUS_KNOWLEDGE; }
    arch.businesses.push(built('cannery', 'bot-boris'));
    for (const routes of [[], ['pelican', 'lighthouse']] as const) {
      arch.routes = [...routes];
      syncShares(world, arch);
      for (const p of world.players) {
        const extra = p.owned.find((a) => a.uid === 'arch-fish');
        const expected = reach(arch, 'pelican').includes(p.id) ? Math.round(100 * world.market.fish * R.CANNERY_FISH_BONUS) : 0;
        expect(extra ? currentIncome(extra, world.market, p.knowledge) : 0).toBe(expected);
      }
    }
  });

  it('отсрочка соседу сохраняет договорный процентный срок, самостоятельное дело не считается наследием', () => {
    const { world, arch } = setup();
    const bot = getPlayer(world, 'bot-mia');
    arch.choice = { kind: 'loanRequest', week: 1, borrower: bot.id, cls: 'reliable',
      amount: 2000, weeklyRate: R.BANK_RATE.reliable, term: 8 };
    applyArchAction(world, arch, { type: 'resolveChoice', accept: true });
    const due = arch.loans[0].dueWeek;
    bot.cash = 0;
    world.week = due;
    report(world);
    settleArch(world, arch);
    expect(arch.loans[0].tries).toBe(1);
    expect(arch.loans[0].dueWeek).toBe(due + R.NEIGHBOR_LOAN_RETRY);
    bot.cash = 5000;
    world.week = arch.loans[0].dueWeek;
    report(world);
    const before = world.players[0].cash;
    settleArch(world, arch);
    const interest = Math.round(2000 * R.BANK_RATE.reliable * 8);
    expect(world.players[0].cash - before).toBe(2000 + interest);
    expect(arch.log.bankInterest).toBe(interest);
    expect(arch.loans).toEqual([]);
    arch.businesses.push(built('hotel', bot.id));
    syncShares(world, arch);
    const ended = applyAction(world, { type: 'endWeek' }).world;
    settleArch(ended, arch);
    expect(ended.lastReport!.players[bot.id].assetIncome.find((a) => a.assetUid === 'arch-biz-hotel')!.amount).toBeGreaterThan(0);
    expect(arch.log.paidToNeighbors).toBe(0);
  });

  it('восстанавливает проданную долю из снимка, учитывая санитарный счётчик', () => {
    const { world, arch } = setup();
    arch.businesses.push(built('hotel', 'bot-mia'));
    syncShares(world, arch);
    const bot = getPlayer(world, 'bot-mia');
    const share = structuredClone(bot.owned.find((a) => a.uid === 'arch-biz-hotel'));
    bot.owned = bot.owned.filter((a) => a.uid !== 'arch-biz-hotel');
    report(world);
    settleArch(world, arch);
    expect(bot.owned.find((a) => a.uid === 'arch-biz-hotel')).toEqual(share);
    expect(arch.log.restoredShares).toBe(1);
  });

  it('все стратегии проходят 160 недель без NaN и проданных долей', () => {
    for (const name of STRATEGY_NAMES) {
      const game = runGame(1, 160, name);
      expect(badNumbers(game)).toBe(false);
      expect(game.world.week).toBe(161);
      expect(game.arch.log.restoredShares).toBe(0);
      expect(humanBusinessCount(game.arch)).toBeLessThanOrEqual(R.MAX_HUMAN_BUSINESSES);
      expect(game.world.players.flatMap((p) => p.owned).filter((a) => a.uid.startsWith('arch-'))
        .every((a) => a.defId === 'deposit' && a.price === 0 && a.slotIndex >= 1000)).toBe(true);
    }
  });
});
