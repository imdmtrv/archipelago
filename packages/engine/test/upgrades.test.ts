// Улучшения активов: лодка → баркас → траулер. Действие, виды для UI, новости, боты, миграция.
import { describe, expect, it } from 'vitest';
import { POLICIES, runBots, runBotTurn, type Policy } from '../src/bots';
import { ASSET_DEFS } from '../src/content';
import { insurancePremium, repairCost, saleValue } from '../src/economy';
import { rollWorldEvent } from '../src/events';
import { migrateWorld } from '../src/migrate';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import { assetViews, financeView, offerViews } from '../src/selectors';
import type { Action, AssetView, PlayerWeekReport, WorldState } from '../src/types';
import { settleWeek } from '../src/week';
import { badNumbers, deepFreeze, giveAsset, newWorld, player, putOffer, soloWorld } from './helpers';

function ok(world: WorldState, action: Action): WorldState {
  const result = applyAction(world, action);
  expect(result.error, action.type).toBeUndefined();
  return result.world;
}

function upgradeOf(assetUid: string, playerId = 'p1'): Action {
  return { type: 'upgradeAsset', playerId, assetUid };
}

function viewOf(world: WorldState, assetUid: string, playerId = 'p1'): AssetView {
  return assetViews(world, playerId).find((v) => v.asset.uid === assetUid)!;
}

/** Человек один на острове, рынок рыбы ровно 1.0, монет с запасом. */
function richWorld(cash = 5000): WorldState {
  const world = soloWorld();
  world.market.fish = 1;
  player(world).cash = cash;
  return world;
}

/** ГПСЧ, который всегда выдаёт 0: любое событие «случается», выбирается первый вариант. */
class ZeroRng extends Rng {
  override next(): number {
    return 0;
  }
}

// ───────────── Контент ─────────────

describe('контент улучшений', () => {
  const UPGRADABLE = ['boat', 'smokehouse', 'cottage', 'bungalow', 'cafe'];

  it('две ступени у лодки, коптильни, домика, бунгало и кафе — и ни у чего больше', () => {
    for (const def of Object.values(ASSET_DEFS)) {
      if (UPGRADABLE.includes(def.id)) {
        expect(def.upgrades, def.id).toHaveLength(2);
      } else {
        expect(def.upgrades, def.id).toBeUndefined();
      }
    }
    expect(ASSET_DEFS.boat.upgrades!.map((u) => [u.cost, u.income, u.upkeep])).toEqual([[400, 32, 12], [700, 40, 15]]);
    expect(ASSET_DEFS.cottage.upgrades!.map((u) => [u.cost, u.income, u.upkeep])).toEqual([[800, 52, 18], [1100, 63, 24]]);
  });

  it('окупаемость при рынке 1.0: вторая ступень 18–24 недели, третья 22–30 — медленнее новой сделки', () => {
    for (const id of UPGRADABLE) {
      const def = ASSET_DEFS[id];
      const basePayback = def.price / (def.income - def.upkeep);
      const [second, third] = def.upgrades!.map((u) => u.cost / (u.income - u.upkeep));
      expect(second, id).toBeGreaterThanOrEqual(18);
      expect(second, id).toBeLessThanOrEqual(24);
      expect(third, id).toBeGreaterThanOrEqual(22);
      expect(third, id).toBeLessThanOrEqual(30);
      expect(second, id).toBeGreaterThan(basePayback);
      expect(third, id).toBeGreaterThan(second);
    }
  });

  it('третья ступень требует знаний; у кафе и коптильни — второго уровня', () => {
    for (const id of UPGRADABLE) {
      const [second, third] = ASSET_DEFS[id].upgrades!;
      expect(second.minKnowledge, id).toBeGreaterThanOrEqual(ASSET_DEFS[id].minKnowledge);
      expect(third.minKnowledge, id).toBeGreaterThanOrEqual(1);
    }
    expect(ASSET_DEFS.cafe.upgrades![1].minKnowledge).toBe(2);
    expect(ASSET_DEFS.smokehouse.upgrades![1].minKnowledge).toBe(2);
  });
});

// ───────────── Действие ─────────────

describe('улучшение актива', () => {
  it('новый актив с доски — первого уровня', () => {
    const world = soloWorld();
    const offer = putOffer(world, 'boat', { price: 240 });
    const after = ok(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid });
    expect(player(after).owned[0].level).toBe(1);
  });

  it('лодка → баркас: монеты списываются, доход, содержание и цена растут, место то же', () => {
    const world = richWorld(1000);
    const boat = giveAsset(world, 'p1', 'boat', { price: 240, income: 19, slotIndex: 2 });
    const after = ok(world, upgradeOf(boat.uid));
    const p = player(after);
    expect(p.cash).toBe(1000 - 400);
    expect(p.owned).toHaveLength(1);
    expect(p.owned[0]).toMatchObject({
      uid: boat.uid, defId: 'boat', level: 2, price: 240 + 400, income: 19 + 32, upkeep: 4 + 12,
      slotIndex: 2, damaged: false, boughtWeek: boat.boughtWeek,
    });
  });

  it('баркас → траулер со знанием 1; дальше улучшать некуда', () => {
    let world = richWorld();
    player(world).knowledge = 1;
    const boat = giveAsset(world, 'p1', 'boat');
    world = ok(ok(world, upgradeOf(boat.uid)), upgradeOf(boat.uid));
    expect(player(world).owned[0]).toMatchObject({ level: 3, price: 250 + 400 + 700, income: 20 + 32 + 40, upkeep: 4 + 12 + 15 });
    expect(player(world).cash).toBe(5000 - 400 - 700);
    const result = applyAction(world, upgradeOf(boat.uid));
    expect(result.error).toEqual({ code: 'noUpgrade' });
    expect(result.world).toBe(world);
  });

  it('улучшение не требует свободного места', () => {
    let world = richWorld();
    const boats = [0, 1, 2, 3].map(() => giveAsset(world, 'p1', 'boat'));
    world = ok(world, upgradeOf(boats[3].uid));
    expect(player(world).owned).toHaveLength(4);
    expect(player(world).owned[3].level).toBe(2);
  });

  it('у вклада, доли, аферы и статусных вещей улучшений нет', () => {
    const world = richWorld();
    player(world).knowledge = 3;
    for (const id of ['deposit', 'shares', 'pearlFarm', 'fountain', 'garden']) {
      const asset = giveAsset(world, 'p1', id);
      expect(applyAction(world, upgradeOf(asset.uid)).error, id).toEqual({ code: 'noUpgrade' });
    }
  });

  it('чужой или несуществующий объект — отказ', () => {
    const world = newWorld();
    const miaBoat = giveAsset(world, 'bot-mia', 'boat');
    expect(applyAction(world, upgradeOf(miaBoat.uid)).error).toEqual({ code: 'noSuchAsset' });
    expect(applyAction(world, upgradeOf('nope')).error).toEqual({ code: 'noSuchAsset' });
    expect(applyAction(world, { type: 'upgradeAsset', playerId: 'ghost', assetUid: miaBoat.uid }).error).toEqual({ code: 'unknownPlayer' });
  });

  it('повреждённое сначала чинят', () => {
    let world = richWorld();
    const boat = giveAsset(world, 'p1', 'boat', { damaged: true });
    const result = applyAction(world, upgradeOf(boat.uid));
    expect(result.error).toEqual({ code: 'repairFirst' });
    expect(result.world).toBe(world);
    world = ok(world, { type: 'repairAsset', playerId: 'p1', assetUid: boat.uid });
    ok(world, upgradeOf(boat.uid));
  });

  it('без знаний третья ступень закрыта: «Нужно знание N»', () => {
    const world = richWorld();
    const boat = giveAsset(world, 'p1', 'boat', { level: 2 });
    const cafe = giveAsset(world, 'p1', 'cafe', { level: 2 });
    expect(applyAction(world, upgradeOf(boat.uid)).error).toEqual({ code: 'needKnowledge', level: 1 });
    player(world).knowledge = 1;
    expect(applyAction(world, upgradeOf(cafe.uid)).error).toEqual({ code: 'needKnowledge', level: 2 });
    ok(world, upgradeOf(boat.uid));
  });

  it('не хватает монет — сумма в ошибке', () => {
    const world = richWorld(399);
    const boat = giveAsset(world, 'p1', 'boat');
    expect(applyAction(world, upgradeOf(boat.uid)).error).toEqual({ code: 'notEnoughCash', missing: 1 });
    player(world).cash = 280;
    expect(applyAction(world, upgradeOf(boat.uid)).error).toEqual({ code: 'notEnoughCash', missing: 120 });
  });

  it('порядок причин: поломка → знания → монеты', () => {
    const world = richWorld(0);
    const boat = giveAsset(world, 'p1', 'boat', { level: 2, damaged: true });
    expect(applyAction(world, upgradeOf(boat.uid)).error).toEqual({ code: 'repairFirst' });
    player(world).owned[0].damaged = false;
    expect(applyAction(world, upgradeOf(boat.uid)).error).toEqual({ code: 'needKnowledge', level: 1 });
    player(world).knowledge = 1;
    expect(applyAction(world, upgradeOf(boat.uid)).error).toEqual({ code: 'notEnoughCash', missing: 700 });
  });

  it('коды ошибок стабильны', () => {
    expect(applyAction(richWorld(), upgradeOf('missing')).error).toEqual({ code: 'noSuchAsset' });
  });

  it('не меняет входной мир', () => {
    const world = richWorld();
    const boat = giveAsset(world, 'p1', 'boat');
    const snapshot = JSON.stringify(world);
    deepFreeze(world);
    const result = applyAction(world, upgradeOf(boat.uid));
    expect(result.error).toBeUndefined();
    expect(result.world).not.toBe(world);
    expect(JSON.stringify(world)).toBe(snapshot);
    expect(() => assetViews(world, 'p1')).not.toThrow();
  });
});

describe('после улучшения', () => {
  it('доход недели — по новой базе и индексу сектора', () => {
    let world = richWorld();
    world.market.fish = 1.2;
    const boat = giveAsset(world, 'p1', 'boat');
    world = ok(world, upgradeOf(boat.uid));
    const fish = world.market.fish;
    world = ok(world, { type: 'endWeek' });
    const r = world.lastReport!.players.p1;
    expect(r.assetIncome).toEqual([{ assetUid: boat.uid, amount: Math.round(52 * fish) }]);
    expect(r.upkeep).toEqual([{ assetUid: boat.uid, amount: 16 }]);
  });

  it('продажа, ремонт и страховка считаются от всего, что вложено', () => {
    let world = richWorld();
    const boat = giveAsset(world, 'p1', 'boat');
    const before = { sale: saleValue(boat, world.market), premium: insurancePremium(player(world)) };
    expect(before).toEqual({ sale: 150, premium: Math.round(5 + 2.5) });

    world = ok(world, upgradeOf(boat.uid));
    const upgraded = player(world).owned[0];
    expect(saleValue(upgraded, world.market)).toBe(Math.round(650 * 0.6));
    expect(insurancePremium(player(world))).toBe(Math.round(5 + 6.5));
    expect(repairCost(upgraded)).toBe(Math.round(650 * 0.3));

    // и при продаже приходит именно это
    const cash = player(world).cash;
    const sold = ok(world, { type: 'sellAsset', playerId: 'p1', assetUid: boat.uid });
    expect(player(sold).cash).toBe(cash + 390);
  });

  it('повреждённый траулер чинится дороже лодки', () => {
    const world = richWorld();
    giveAsset(world, 'p1', 'boat', { damaged: true });
    giveAsset(world, 'p1', 'boat', { level: 3, price: 1350, income: 92, upkeep: 31, damaged: true });
    expect(assetViews(world, 'p1').map((v) => v.repairCost)).toEqual([75, 405]);
  });

  it('шторм называет объект по уровню', () => {
    const world = richWorld();
    world.upcoming = [{ kind: 'storm', week: world.week, windowStart: world.week, announcedWeek: world.week - 2, real: true, source: 'reliable' }];
    giveAsset(world, 'p1', 'boat', { level: 3 });
    const report: PlayerWeekReport = {
      playerId: 'p1', salary: 0, assetIncome: [], upkeep: [], living: 0, interest: 0, insurance: 0,
      eventsCash: 0, net: 0, cashAfter: 0, happinessDelta: 0, events: [], lostAssetUids: [], freedomReached: false,
    };
    rollWorldEvent(world, new ZeroRng(0), { p1: report });
    expect(report.events[0].id).toBe('stormDamage');
    expect(report.events[0].params).toEqual({ assetRefs: ['boat:3'] });
  });
});

// ───────────── Виды для UI ─────────────

describe('вид актива и улучшения', () => {
  it('id, уровень и сколько всего уровней', () => {
    const world = richWorld();
    giveAsset(world, 'p1', 'boat');
    giveAsset(world, 'p1', 'boat', { level: 2 });
    giveAsset(world, 'p1', 'cottage', { level: 3 });
    giveAsset(world, 'p1', 'deposit');
    const views = assetViews(world, 'p1');
    expect(views.map((v) => [v.def.id, v.level, v.maxLevel])).toEqual([
      ['boat', 1, 3],
      ['boat', 2, 3],
      ['cottage', 3, 3],
      ['deposit', 1, 1],
    ]);
    expect(views[2].upgrade).toBeNull();
    expect(views[3].upgrade).toBeNull();
  });

  it('следующая ступень: стоимость, прибавка, окупаемость, можно ли сейчас', () => {
    const world = richWorld();
    const boat = giveAsset(world, 'p1', 'boat');
    const up = viewOf(world, boat.uid).upgrade!;
    expect(up.def).toBe(ASSET_DEFS.boat.upgrades![0]);
    expect(up).toMatchObject({
      toLevel: 2, cost: 400, incomeGain: 32, upkeepGain: 12, netGain: 20, paybackWeeks: 20, canUpgrade: true,
    });
    expect(up.reason).toBeUndefined();
  });

  it('прибавка дохода — по текущему рынку и с бонусом знаний', () => {
    const world = richWorld();
    world.market.fish = 1.2;
    const boat = giveAsset(world, 'p1', 'boat');
    // round(52 × 1.2) − round(20 × 1.2) = 62 − 24
    expect(viewOf(world, boat.uid).upgrade!.incomeGain).toBe(38);
    player(world).knowledge = 3;
    // round(52 × 1.2 × 1.1) − round(20 × 1.2 × 1.1) = 69 − 26; окупаемость ceil(400 / 31)
    expect(viewOf(world, boat.uid).upgrade).toMatchObject({ incomeGain: 43, netGain: 31, paybackWeeks: 13 });
  });

  it('в плохой рынок прибавка может не покрыть содержание — окупаемости нет', () => {
    const world = richWorld();
    world.market.fish = 0.2;
    const boat = giveAsset(world, 'p1', 'boat');
    expect(viewOf(world, boat.uid).upgrade).toMatchObject({ incomeGain: 6, netGain: -6, paybackWeeks: null });
  });

  it('причины — в том же порядке, что у действия', () => {
    const world = richWorld(100);
    const boat = giveAsset(world, 'p1', 'boat', { level: 2, damaged: true });
    expect(viewOf(world, boat.uid).upgrade).toMatchObject({ canUpgrade: false, reason: { code: 'repairFirst' } });
    player(world).owned[0].damaged = false;
    expect(viewOf(world, boat.uid).upgrade).toMatchObject({ canUpgrade: false, reason: { code: 'needKnowledge', level: 1 } });
    player(world).knowledge = 1;
    expect(viewOf(world, boat.uid).upgrade).toMatchObject({ canUpgrade: false, reason: { code: 'notEnoughCash', missing: 600 } });
    player(world).cash = 700;
    expect(viewOf(world, boat.uid).upgrade).toMatchObject({ canUpgrade: true });
    expect(viewOf(world, boat.uid).upgrade!.reason).toBeUndefined();
  });

  it('свобода после улучшения совпадает со шкалой после настоящего улучшения (со страховкой)', () => {
    let world = richWorld();
    player(world).insured = true;
    giveAsset(world, 'p1', 'cottage');
    const boat = giveAsset(world, 'p1', 'boat');
    const now = financeView(world, 'p1').freedomRatio;
    const predicted = viewOf(world, boat.uid).upgrade!.freedomAfter;
    expect(predicted).toBeGreaterThan(now);
    world = ok(world, upgradeOf(boat.uid));
    expect(financeView(world, 'p1').freedomRatio).toBeCloseTo(predicted, 9);
  });

  it('у повреждённого свобода после — как у целого улучшенного', () => {
    const world = richWorld();
    const boat = giveAsset(world, 'p1', 'boat', { damaged: true });
    const damagedAfter = viewOf(world, boat.uid).upgrade!.freedomAfter;
    player(world).owned[0].damaged = false;
    expect(viewOf(world, boat.uid).upgrade!.freedomAfter).toBeCloseTo(damagedAfter, 9);
  });

  it('предпросмотр покупки тоже знает про уровень: свобода после покупки не сломалась', () => {
    let world = richWorld();
    const offer = putOffer(world, 'cottage');
    const predicted = offerViews(world, 'p1').find((v) => v.offer.uid === offer.uid)!.freedomAfter;
    world = ok(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid });
    expect(financeView(world, 'p1').freedomRatio).toBeCloseTo(predicted, 9);
  });
});

// ───────────── Новости ─────────────

describe('новости об улучшениях', () => {
  /** Политика «улучши первый объект, пока можно». */
  const upgradeFirst: Policy = (_world, me) => {
    const asset = me.owned[0];
    return asset && asset.level < 3 ? { type: 'upgradeAsset', playerId: me.id, assetUid: asset.uid } : null;
  };

  it('Мия улучшила рыбацкую лодку — теперь это баркас (род правильный)', () => {
    const world = newWorld();
    world.market.fish = 1;
    const mia = player(world, 'bot-mia');
    mia.cash = 450;
    giveAsset(world, 'bot-mia', 'boat');
    const turn = runBotTurn(world, 'bot-mia', upgradeFirst);
    expect(turn.errors).toEqual(['bot-mia upgradeAsset: needKnowledge']);
    expect(turn.news).toEqual([{ playerId: 'bot-mia', kind: 'upgraded', defId: 'boat', fromLevel: 1 }]);
  });

  it('Борис улучшил баркас — теперь это траулер; продал траулер', () => {
    const world = newWorld();
    const boris = player(world, 'bot-boris');
    boris.cash = 5000;
    boris.knowledge = 1;
    const boat = giveAsset(world, 'bot-boris', 'boat', { level: 2 });
    const turn = runBotTurn(world, 'bot-boris', upgradeFirst);
    expect(turn.news).toEqual([{ playerId: 'bot-boris', kind: 'upgraded', defId: 'boat', fromLevel: 2 }]);
    const sell: Policy = (_w, me) => (me.owned.length ? { type: 'sellAsset', playerId: me.id, assetUid: boat.uid } : null);
    expect(runBotTurn(turn.world, 'bot-boris', sell).news).toEqual([{ playerId: 'bot-boris', kind: 'sold', defId: 'boat', level: 3 }]);
  });

  it('у каждой ступени есть название для новостей', () => {
    const world = newWorld();
    const tim = player(world, 'bot-timur');
    tim.cash = 100_000;
    tim.knowledge = 3;
    for (const id of ['boat', 'smokehouse', 'cottage', 'bungalow', 'cafe']) giveAsset(world, 'bot-timur', id);
    const all: Policy = (_w, me) => {
      const a = me.owned.find((x) => x.level < 3);
      return a ? { type: 'upgradeAsset', playerId: me.id, assetUid: a.uid } : null;
    };
    const news = runBotTurn(world, 'bot-timur', all).news;
    expect(news).toHaveLength(10);
    expect(news.every((n) => n.kind === 'upgraded')).toBe(true);
    expect(news.map((n) => n.kind === 'upgraded' ? [n.defId, n.fromLevel] : null)).toEqual([
      ['boat', 1], ['boat', 2], ['smokehouse', 1], ['smokehouse', 2], ['cottage', 1], ['cottage', 2],
      ['bungalow', 1], ['bungalow', 2], ['cafe', 1], ['cafe', 2],
    ]);
  });
});

// ───────────── Боты ─────────────

describe('боты и улучшения', () => {
  it('бережливая улучшает, когда на пирсе нет места', () => {
    const world = richWorld(1000);
    world.offers = [];
    player(world).knowledge = 1;
    for (let i = 0; i < 4; i++) giveAsset(world, 'p1', 'boat');
    const action = POLICIES.saver(world, player(world));
    expect(action).toMatchObject({ type: 'upgradeAsset', playerId: 'p1' });
  });

  it('бережливая не улучшает, пока есть место и на доске нечего сравнивать', () => {
    const world = richWorld(1000);
    world.offers = [];
    player(world).knowledge = 1;
    giveAsset(world, 'p1', 'boat');
    expect(POLICIES.saver(world, player(world))?.type).not.toBe('upgradeAsset');
  });

  it('бережливая выбирает то, что окупается быстрее: улучшение или сделку с доски', () => {
    const world = richWorld(1000);
    player(world).knowledge = 1;
    giveAsset(world, 'p1', 'boat'); // улучшение окупится за 20 недель
    world.offers = [];
    putOffer(world, 'deposit', { price: 400, income: 10 }); // 40 недель
    expect(POLICIES.saver(world, player(world))).toMatchObject({ type: 'upgradeAsset' });
    world.offers = [];
    const quick = putOffer(world, 'boat', { price: 200, income: 24 }); // 10 недель
    expect(POLICIES.saver(world, player(world))).toEqual({ type: 'buyOffer', playerId: 'p1', offerUid: quick.uid });
  });

  it('бережливая оставляет запас и не берёт кредит ради улучшения', () => {
    const world = richWorld(420);
    world.offers = [];
    player(world).knowledge = 1;
    for (let i = 0; i < 4; i++) giveAsset(world, 'p1', 'boat');
    expect(POLICIES.saver(world, player(world))?.type).not.toBe('upgradeAsset');
    expect(POLICIES.saver(world, player(world))?.type).not.toBe('takeLoan');
  });

  it('рисковый берёт кредит, чтобы улучшить самый доходный актив', () => {
    const world = richWorld(100);
    world.offers = [];
    giveAsset(world, 'p1', 'boat');
    const cottage = giveAsset(world, 'p1', 'cottage');
    const turn = runBotTurn(world, 'p1', POLICIES.gambler);
    expect(turn.errors).toEqual([]);
    expect(turn.actions.slice(0, 2)).toEqual([
      { type: 'takeLoan', playerId: 'p1', amount: 700 },
      { type: 'upgradeAsset', playerId: 'p1', assetUid: cottage.uid },
    ]);
    expect(player(turn.world).owned.find((a) => a.uid === cottage.uid)!.level).toBe(2);
  });

  it('за долгие партии все соседи что-то улучшают без единой ошибки, Тимур — реже всех', () => {
    const upgrades = { 'bot-mia': 0, 'bot-timur': 0, 'bot-boris': 0 } as Record<string, number>;
    for (let seed = 1; seed <= 6; seed++) {
      let world = newWorld(seed);
      for (let week = 0; week < 150; week++) {
        const human = runBotTurn(world, 'p1', POLICIES.saver);
        expect(human.errors).toEqual([]);
        const bots = runBots(human.world);
        expect(bots.errors, `seed ${seed} week ${week}`).toEqual([]);
        for (const action of bots.actions) {
          if (action.type === 'upgradeAsset') upgrades[action.playerId]++;
        }
        const own = bots.world === human.world ? structuredClone(bots.world) : bots.world;
        world = settleWeek(own, bots.news);
      }
      expect(badNumbers(world)).toEqual([]);
      for (const p of world.players) {
        expect(badNumbers(assetViews(world, p.id))).toEqual([]);
        for (const a of p.owned) {
          expect(a.level).toBeGreaterThanOrEqual(1);
          expect(a.level).toBeLessThanOrEqual(1 + (ASSET_DEFS[a.defId].upgrades?.length ?? 0));
        }
      }
    }
    expect(upgrades['bot-mia']).toBeGreaterThan(0);
    expect(upgrades['bot-boris']).toBeGreaterThan(0);
    expect(upgrades['bot-timur']).toBeLessThan(upgrades['bot-mia']);
  });
});

// ───────────── Миграция ─────────────

/** Сохранение версии 2: всё как сейчас, только без уровней улучшений. */
function v2Save(): Record<string, unknown> {
  let world = newWorld(21);
  for (let i = 0; i < 12; i++) world = ok(world, { type: 'endWeek' });
  const raw = JSON.parse(JSON.stringify(world)) as Record<string, unknown>;
  raw.version = 2;
  for (const p of raw.players as Record<string, unknown>[]) {
    for (const a of p.owned as Record<string, unknown>[]) delete a.level;
  }
  return raw;
}

function ownedOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  return (raw.players as Record<string, unknown>[]).flatMap((p) => p.owned as Record<string, unknown>[]);
}

describe('миграция: версия 3', () => {
  it('2 → 3: всё купленное получает первый уровень, вход не меняется', () => {
    const raw = v2Save();
    expect(ownedOf(raw).length).toBeGreaterThan(0);
    const snapshot = JSON.stringify(raw);
    const world = migrateWorld(raw)!;
    expect(world).not.toBeNull();
    expect(world.version).toBe(6);
    expect(JSON.stringify(raw)).toBe(snapshot);
    const owned = world.players.flatMap((p) => p.owned);
    expect(owned).toHaveLength(ownedOf(raw).length);
    expect(owned.every((a) => a.level === 1)).toBe(true);
    // и мир играбелен
    const next = ok(world, { type: 'endWeek' });
    expect(badNumbers(next)).toEqual([]);
    expect(badNumbers(assetViews(next, 'p1'))).toEqual([]);
  });

  it('2 → 3: уже записанный уровень не трогается', () => {
    const raw = v2Save();
    ownedOf(raw)[0].level = 2;
    const world = migrateWorld(raw)!;
    expect(world.players.flatMap((p) => p.owned)[0].level).toBe(2);
  });

  it('1 → 2 → 3: старое сохранение проходит всю цепочку', () => {
    const raw = v2Save();
    raw.version = 1;
    for (const p of raw.players as Record<string, unknown>[]) {
      delete p.employed;
      delete p.threatWeeks;
      delete p.bestLevel;
      delete p.dream;
    }
    const world = migrateWorld(raw)!;
    expect(world).not.toBeNull();
    expect(world.version).toBe(6);
    expect(world.players[0].dream).toMatchObject({ id: 'schooner', built: 0 });
    expect(world.players.flatMap((p) => p.owned).every((a) => a.level === 1)).toBe(true);
    expect(JSON.stringify(ok(migrateWorld(raw)!, { type: 'endWeek' }))).toBe(JSON.stringify(ok(world, { type: 'endWeek' })));
  });

  it('непонятное — null', () => {
    const v3 = JSON.parse(JSON.stringify(migrateWorld(v2Save()))) as Record<string, unknown>;
    const broken = (base: Record<string, unknown>, patch: (w: Record<string, unknown>) => void): unknown => {
      const copy = structuredClone(base);
      patch(copy);
      return copy;
    };
    const garbage: unknown[] = [
      broken(v3, (w) => { delete ownedOf(w)[0].level; }),          // версия 3 без уровня
      broken(v3, (w) => { ownedOf(w)[0].level = 0; }),
      broken(v3, (w) => { ownedOf(w)[0].level = 1.5; }),
      broken(v3, (w) => { ownedOf(w)[0].level = '2'; }),
      broken(v3, (w) => { ((w.players as Record<string, unknown>[])[0].owned as unknown[]).push(null); }),
      broken(v2Save(), (w) => { ((w.players as Record<string, unknown>[])[0].owned as unknown[]).push(7); }),
      broken(v2Save(), (w) => { ownedOf(w)[0].level = -1; }),
      broken(v2Save(), (w) => { delete (w.players as Record<string, unknown>[])[1].employed; }),
    ];
    for (const raw of garbage) expect(migrateWorld(raw)).toBeNull();
  });
});
