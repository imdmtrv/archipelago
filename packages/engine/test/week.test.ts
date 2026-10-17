import { describe, expect, it } from 'vitest';
import { runBots, POLICIES, runBotTurn } from '../src/bots';
import { rollWorldEvent } from '../src/events';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import { BOARD_SIZE, EMERGENCY_RATE } from '../src/rules';
import { assetViews, financeView, leaderboard, offerViews } from '../src/selectors';
import type { PlayerWeekReport, WorldState } from '../src/types';
import { settleWeek } from '../src/week';
import { badNumbers, giveAsset, newWorld, player, putOffer, soloWorld } from './helpers';

function endWeek(world: WorldState): WorldState {
  const result = applyAction(world, { type: 'endWeek' });
  expect(result.error).toBeUndefined();
  return result.world;
}

/** ГПСЧ, который всегда выдаёт 0: любое событие «случается», выбирается первый вариант. */
class ZeroRng extends Rng {
  override next(): number {
    return 0;
  }
}

function emptyReport(playerId: string): PlayerWeekReport {
  return {
    playerId, salary: 0, assetIncome: [], upkeep: [], living: 0, interest: 0, insurance: 0,
    eventsCash: 0, net: 0, cashAfter: 0, happinessDelta: 0, events: [], lostAssetUids: [], freedomReached: false, arch: null,
  };
}

describe('итоги недели', () => {
  it('зарплата, доходы, расходы и отчёт сходятся с наличными', () => {
    let world = soloWorld(11);
    giveAsset(world, 'p1', 'cottage', { income: 40, upkeep: 6 });
    const cashBefore = player(world).cash;
    world = endWeek(world);
    const r = world.lastReport!.players.p1;
    expect(world.lastReport!.week).toBe(1);
    expect(world.week).toBe(2);
    expect(r.salary).toBe(180);
    expect(r.assetIncome[0].amount).toBe(40);
    expect(r.upkeep[0].amount).toBe(6);
    expect(r.living).toBe(150);
    expect(r.net).toBe(180 + 40 - 6 - 150 + r.eventsCash);
    expect(r.cashAfter).toBe(player(world).cash);
    if (!r.events.some((e) => e.id === 'emergencyLoan')) expect(r.cashAfter).toBe(cashBefore + r.net);
  });

  it('заём у ростовщика, если монет меньше нуля', () => {
    let world = soloWorld();
    player(world).cash = 0;
    giveAsset(world, 'p1', 'yacht', { upkeep: 400 });
    world = endWeek(world);
    const p = player(world);
    expect(p.cash).toBeGreaterThanOrEqual(0);
    const loan = p.loans.find((l) => l.emergency)!;
    expect(loan.weeklyRate).toBe(EMERGENCY_RATE);
    expect(loan.principal).toBeGreaterThanOrEqual(370 - 200); // минимум: дыра за вычетом возможного подарка
    expect(loan.principal % 10).toBe(0);
    const event = world.lastReport!.players.p1.events.find((e) => e.id === 'emergencyLoan')!;
    expect(event.params).toMatchObject({ amount: loan.principal, rate: Math.round(EMERGENCY_RATE * 100) });
    expect(event.tone).toBe('bad');
  });

  it('счастье: будни −3, статусные вещи радуют, границы 0..100', () => {
    let world = soloWorld();
    giveAsset(world, 'p1', 'fountain');
    world = endWeek(world);
    expect(world.lastReport!.players.p1.happinessDelta).toBe(0);
    player(world).happiness = 1;
    player(world).owned = [];
    world = endWeek(world);
    expect(player(world).happiness).toBe(0);
  });
});

describe('аферы', () => {
  it('покупка афёры назначает скрытую неделю краха через 2–5 недель жизни', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = soloWorld(seed);
      const offer = putOffer(world, 'pearlFarm', { price: 100 });
      const after = applyAction(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid }).world;
      const farm = player(after).owned[0];
      expect(farm.collapseWeek).toBeGreaterThanOrEqual(world.week + 1);
      expect(farm.collapseWeek).toBeLessThanOrEqual(world.week + 4);
    }
  });

  it('ферма платит, пока жива, и исчезает в неделю краха', () => {
    let world = soloWorld();
    const farm = giveAsset(world, 'p1', 'pearlFarm', { income: 200, collapseWeek: 2 });
    world = endWeek(world);
    expect(world.lastReport!.players.p1.assetIncome).toEqual([{ assetUid: farm.uid, amount: 200 }]);
    expect(player(world).owned).toHaveLength(1);

    world = endWeek(world);
    const r = world.lastReport!.players.p1;
    expect(r.assetIncome).toEqual([]);
    expect(r.lostAssetUids).toEqual([farm.uid]);
    const event = r.events.find((e) => e.id === 'scamCollapse')!;
    expect(event.tone).toBe('bad');
    expect(event.params).toEqual({ defId: 'pearlFarm' });
    expect(player(world).owned).toHaveLength(0);
  });

  it('доход афёры не делает свободным', () => {
    let world = soloWorld();
    giveAsset(world, 'p1', 'pearlFarm', { income: 1000, collapseWeek: 50 });
    world = endWeek(world);
    expect(financeView(world, 'p1').freedomRatio).toBeGreaterThan(1);
    expect(player(world).freedomWeek).toBeNull();
  });
});

describe('шторм и страховка', () => {
  it('застрахованным шторм не вредит, остальным — повреждает', () => {
    const world = newWorld();
    world.players = world.players.slice(0, 2);
    player(world, 'p1').insured = true;
    player(world, 'p1').insuranceFrom = 1;
    world.upcoming = [{ kind: 'storm', week: 1, windowStart: 1, announcedWeek: -1, real: true, source: 'reliable' }];
    const insuredBoat = giveAsset(world, 'p1', 'boat');
    const bareBoat = giveAsset(world, 'bot-mia', 'boat');
    const reports = { p1: emptyReport('p1'), 'bot-mia': emptyReport('bot-mia') };

    const events = rollWorldEvent(world, new ZeroRng(0), reports);
    expect(events.map((e) => e.id)).toEqual(['storm']);
    expect(events[0].affectedAssetUids).toEqual([bareBoat.uid]);

    expect(player(world, 'p1').owned[0].damaged).toBe(false);
    const insuredEvent = reports.p1.events[0];
    expect(insuredEvent.id).toBe('stormInsured');
    expect(insuredEvent.params).toEqual({ assetRefs: ['boat:1'] });
    expect(insuredEvent.affectedAssetUids).toEqual([insuredBoat.uid]);

    expect(player(world, 'bot-mia').owned[0].damaged).toBe(true);
    expect(reports['bot-mia'].events[0].id).toBe('stormDamage');
  });

  it('повреждённый актив не приносит дохода, пока не починят', () => {
    let world = soloWorld();
    giveAsset(world, 'p1', 'cottage', { damaged: true });
    expect(assetViews(world, 'p1')[0]).toMatchObject({ currentIncome: 0, repairCost: 210 });
    world = endWeek(world);
    expect(world.lastReport!.players.p1.assetIncome).toEqual([]);
  });

  it('страховка покрывает лечение и стоит премию каждую неделю', () => {
    let world = soloWorld(3);
    player(world).insured = true;
    player(world).insuranceFrom = 1;
    giveAsset(world, 'p1', 'boat', { price: 300 });
    let illnessSeen = false;
    for (let i = 0; i < 80; i++) {
      world = endWeek(world);
      const r = world.lastReport!.players.p1;
      expect(r.insurance).toBe(5 + 3);
      for (const e of r.events.filter((x) => x.id === 'illness')) {
        illnessSeen = true;
        expect(e.cashDelta).toBe(0);
      }
    }
    expect(illnessSeen).toBe(true);
  });
});

describe('свобода', () => {
  it('отмечается один раз, неделя запоминается, новость выходит', () => {
    let world = soloWorld();
    giveAsset(world, 'p1', 'deposit', { income: 400 });
    world = endWeek(world);
    expect(player(world).freedomWeek).toBe(1);
    expect(world.lastReport!.players.p1.freedomReached).toBe(true);
    expect(world.lastReport!.news).toContainEqual({ playerId: 'p1', kind: 'freedom', week: 1 });

    world = endWeek(world);
    expect(player(world).freedomWeek).toBe(1);
    expect(world.lastReport!.players.p1.freedomReached).toBe(false);
  });

  it('бот получает новость с правильным родом', () => {
    let world = newWorld();
    giveAsset(world, 'bot-mia', 'deposit', { income: 400 });
    world = endWeek(world);
    expect(world.lastReport!.news).toContainEqual({ playerId: 'bot-mia', kind: 'freedom', week: 1 });
  });

  it('ничего не делая, свободы не достичь', () => {
    let world = soloWorld(8);
    for (let i = 0; i < 150; i++) world = endWeek(world);
    expect(player(world).freedomWeek).toBeNull();
  });
});

describe('доска сделок', () => {
  it('предложения живут 3 недели, доска всегда пополняется до 4', () => {
    let world = soloWorld(5);
    const firstUids = world.offers.map((o) => o.uid);
    expect(world.offers.every((o) => o.expiresWeek === 3)).toBe(true);
    for (let i = 0; i < 3; i++) {
      world = endWeek(world);
      expect(world.offers).toHaveLength(BOARD_SIZE);
      expect(world.offers.every((o) => o.expiresWeek >= world.week && o.expiresWeek <= world.week + 2)).toBe(true);
    }
    expect(world.week).toBe(4);
    expect(world.offers.some((o) => firstUids.includes(o.uid))).toBe(false);
    expect(offerViews(world, 'p1').every((v) => v.weeksLeft >= 0 && v.weeksLeft <= 2)).toBe(true);
  });

  it('купленное предложение заменяется новым в конце недели', () => {
    let world = soloWorld(5);
    const offer = putOffer(world, 'boat', { price: 100 });
    world.offers = [offer, ...world.offers.slice(0, 3)];
    world = applyAction(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid }).world;
    expect(world.offers).toHaveLength(3);
    world = endWeek(world);
    expect(world.offers).toHaveLength(4);
  });
});

describe('боты и длинные партии', () => {
  it('боты не совершают ошибочных действий 200 недель на многих сидах', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let world = newWorld(seed);
      for (let week = 0; week < 200; week++) {
        const human = runBotTurn(world, 'p1', POLICIES.saver);
        expect(human.errors).toEqual([]);
        const bots = runBots(human.world);
        expect(bots.errors, `seed ${seed} week ${week}`).toEqual([]);
        const own = bots.world === human.world ? structuredClone(bots.world) : bots.world;
        world = settleWeek(own, bots.news);
      }
    }
  }, 30_000); // 25 сидов × 200 недель: с улучшениями боты думают дольше стандартных 5 с

  it('боты покупают с общей доски и попадают в новости', () => {
    let world = newWorld(4);
    const news = [];
    for (let i = 0; i < 20; i++) {
      world = endWeek(world);
      news.push(...world.lastReport!.news);
    }
    expect(news.some((n) => n.playerId === 'bot-mia' && n.kind === 'bought')).toBe(true);
    expect(news.some((n) => n.playerId === 'bot-boris')).toBe(true);
  });

  it('нигде нет NaN и бесконечностей за 300 недель', () => {
    for (const seed of [1, 2, 3, 99, 2024]) {
      let world = newWorld(seed);
      for (let week = 0; week < 300; week++) {
        world = runBotTurn(world, 'p1', POLICIES.gambler).world;
        world = endWeek(world);
        if (week % 50 === 0 || week === 299) {
          expect(badNumbers(world)).toEqual([]);
          expect(badNumbers(leaderboard(world))).toEqual([]);
          for (const p of world.players) {
            expect(badNumbers(financeView(world, p.id))).toEqual([]);
            expect(badNumbers(offerViews(world, p.id))).toEqual([]);
            expect(badNumbers(assetViews(world, p.id))).toEqual([]);
          }
        }
      }
      expect(world.market.fish).toBeGreaterThanOrEqual(0.6);
      expect(world.market.fish).toBeLessThanOrEqual(1.5);
      expect(world.players.every((p) => p.happiness >= 0 && p.happiness <= 100)).toBe(true);
    }
  });

  it('таблица лидеров отсортирована по доле свободы', () => {
    let world = newWorld(6);
    for (let i = 0; i < 30; i++) world = endWeek(world);
    const rows = leaderboard(world);
    expect(rows).toHaveLength(4);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].freedomRatio).toBeGreaterThanOrEqual(rows[i].freedomRatio);
  });
});
