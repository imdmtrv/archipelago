import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateChoice, settleLent } from '../src/choices';
import { GOALS } from '../src/content';
import { currentIncome, saleValue, weeklyExpenses } from '../src/economy';
import { choiceView, goalsView, insuranceActive, rumorViews } from '../src/engagement';
import { rollWorldEvent } from '../src/events';
import { goalProgress, settleGoals } from '../src/goals';
import { migrateWorld } from '../src/migrate';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import * as R from '../src/rules';
import { financeView } from '../src/selectors';
import type { ChoiceKind, PendingChoice, PlayerWeekReport, WorldState } from '../src/types';
import { settleWeek } from '../src/week';
import { giveAsset, newWorld, player, putOffer, soloWorld } from './helpers';
import { makeSensible } from '../scripts/policies';

afterEach(() => vi.restoreAllMocks());

function emptyReport(playerId = 'p1'): PlayerWeekReport {
  return { playerId, salary: 0, assetIncome: [], upkeep: [], living: 0, interest: 0, insurance: 0,
    eventsCash: 0, net: 0, cashAfter: 0, happinessDelta: 0, events: [], lostAssetUids: [], freedomReached: false };
}

function reports(world: WorldState) {
  return Object.fromEntries(world.players.map((p) => [p.id, emptyReport(p.id)]));
}

class ChoiceRng extends Rng {
  constructor(private kind: ChoiceKind = 'neighborLoan') { super(0); }
  override next() { return 0; }
  override weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    return (this.kind in weights ? this.kind : Object.keys(weights)[0]) as K;
  }
}

function pending(world: WorldState, kind: ChoiceKind, params: PendingChoice['params']) {
  player(world).choice = { uid: 'c-test', kind, week: world.week, params };
}

function resolve(world: WorldState, accept = true) {
  return applyAction(world, { type: 'resolveChoice', playerId: 'p1', accept });
}

describe('слухи', () => {
  it('события планируются заранее, приходят каждому и не дублируют неделю', () => {
    const world = newWorld();
    player(world, 'bot-mia').knowledge = R.RUMOR_EXACT_KNOWLEDGE;
    const report = reports(world);
    expect(rollWorldEvent(world, new ChoiceRng(), report)).toEqual([]);
    expect(world.upcoming).toEqual([{ kind: 'storm', week: 3, windowStart: 3, announcedWeek: 1, real: true, source: 'reliable' }]);
    for (const p of world.players) {
      expect(report[p.id].events[0]).toMatchObject({ id: 'rumor', tone: 'neutral', params: { kind: 'storm', source: 'reliable', fromWeek: 3, toWeek: 4 } });
      expect(report[p.id].events[0].params?.exactWeek).toBe(p.knowledge >= R.RUMOR_EXACT_KNOWLEDGE ? 3 : undefined);
    }
    rollWorldEvent(world, new ChoiceRng(), report);
    expect(world.upcoming).toHaveLength(1);
    expect(report.p1.events).toHaveLength(1);
  });

  it('представления отсортированы, точность зависит от знаний, чтение не меняет мир', () => {
    const world = soloWorld();
    world.upcoming = [
      { kind: 'crisis', week: 5, windowStart: 4, announcedWeek: 1, real: false, source: 'gossip' },
      { kind: 'fishShoal', week: 3, windowStart: 3, announcedWeek: 1, real: true, source: 'reliable' },
    ];
    const before = JSON.stringify(world);
    expect(rumorViews(world, 'p1').map((r) => [r.kind, r.exactWeek])).toEqual([['fishShoal', null], ['crisis', null]]);
    expect(JSON.stringify(world)).toBe(before);
    player(world).knowledge = R.RUMOR_EXACT_KNOWLEDGE;
    expect(rumorViews(world, 'p1').map((r) => r.exactWeek)).toEqual([3, 5]);
    expect(rumorViews(world, 'p1').map((r) => r.source)).toEqual(['reliable', 'gossip']);
    expect(rumorViews(world, 'p1').every((r) => !('real' in r))).toBe(true);
    expect(rumorViews(world, 'missing')).toEqual([]);
  });

  it('срабатывает ровно в объявленном окне, не больше одного на неделю; повтор детерминирован', () => {
    const run = () => {
      const world = soloWorld(125);
      const announced = new Map<number, { kind: string; from: number; to: number }>();
      let fired = 0;
      for (let week = 0; week < 120; week++) {
        settleWeek(world, []);
        expect(new Set(world.upcoming.map((e) => e.week)).size).toBe(world.upcoming.length);
        for (const e of world.upcoming) {
          expect(e.week - e.announcedWeek).toBeGreaterThanOrEqual(R.RUMOR_LEAD[0]);
          expect(e.week - e.announcedWeek).toBeLessThanOrEqual(R.RUMOR_LEAD[1]);
          announced.set(e.week, { kind: e.kind, from: e.windowStart, to: e.windowStart + 1 });
        }
        const report = world.lastReport!;
        expect(report.worldEvents.length).toBeLessThanOrEqual(1);
        for (const e of report.worldEvents) {
          const rumor = announced.get(report.week)!;
          expect(e.id).toBe(rumor.kind);
          expect(report.week).toBeGreaterThanOrEqual(rumor.from);
          expect(report.week).toBeLessThanOrEqual(rumor.to);
          fired++;
        }
      }
      expect(fired).toBeGreaterThan(0);
      return world;
    };
    expect(run()).toEqual(run());
  });

  it.each(['fishShoal', 'touristBoom', 'crisis'] as const)('сохраняет рыночные эффекты %s', (kind) => {
    const world = soloWorld();
    world.upcoming = [{ kind, week: 1, windowStart: 1, announcedWeek: -1, real: true, source: 'reliable' }];
    vi.spyOn(Rng.prototype, 'chance').mockReturnValue(false);
    expect(rollWorldEvent(world, new Rng(0), reports(world))[0].id).toBe(kind);
    expect(world.market.fishShock).toBe(kind === 'fishShoal' ? R.SHOAL_FISH_SHOCK : kind === 'crisis' ? R.CRISIS_FISH_SHOCK : 0);
    expect(world.market.tourismShock).toBe(kind === 'touristBoom' ? R.BOOM_TOURISM_SHOCK : kind === 'crisis' ? R.CRISIS_TOURISM_SHOCK : 0);
    expect(world.upcoming).toEqual([]);
  });

  it.each(['storm', 'fishShoal', 'touristBoom', 'crisis'] as const)('ложный %s только опровергается у каждого игрока', (kind) => {
    const world = newWorld();
    const asset = giveAsset(world, 'p1', 'boat');
    player(world).insured = true;
    player(world).insuranceFrom = 1;
    world.upcoming = [{ kind, week: 1, windowStart: 1, announcedWeek: -1, real: false, source: 'gossip' }];
    const before = structuredClone(world.market);
    const report = reports(world);
    vi.spyOn(Rng.prototype, 'chance').mockReturnValue(false);
    expect(rollWorldEvent(world, new Rng(0), report)).toEqual([]);
    expect(world.market).toEqual(before);
    expect(asset.damaged).toBe(false);
    expect(player(world).goals!.insuredStorm).toBe(false);
    expect(world.upcoming).toEqual([]);
    for (const p of world.players) expect(report[p.id].events).toEqual([{ id: 'rumorFalse', tone: 'neutral', params: { kind } }]);
  });

  it('надёжные слухи сбываются примерно в 9/10, болтовня — меньше чем в половине (500 сидов)', () => {
    const counts = { reliable: { real: 0, total: 0 }, gossip: { real: 0, total: 0 } };
    for (let seed = 1; seed <= 500; seed++) {
      const world = soloWorld(seed);
      const rng = new Rng(seed);
      for (let week = 1; week <= 104; week++) {
        world.week = week;
        const due = world.upcoming.find((e) => e.week === week);
        const report = reports(world);
        const events = rollWorldEvent(world, rng, report);
        if (due) {
          counts[due.source].total++;
          counts[due.source].real += Number(due.real);
          expect(events.map((e) => e.id)).toEqual(due.real ? [due.kind] : []);
          expect(report.p1.events.some((e) => e.id === 'rumorFalse')).toBe(!due.real);
        }
        expect(new Set(world.upcoming.map((e) => e.week)).size).toBe(world.upcoming.length);
        for (const e of world.upcoming.filter((e) => e.announcedWeek === week)) {
          expect(report.p1.events).toContainEqual({ id: 'rumor', tone: 'neutral', params: {
            kind: e.kind, source: e.source, fromWeek: e.windowStart, toWeek: e.windowStart + 1,
          } });
        }
      }
    }
    const reliable = counts.reliable.real / counts.reliable.total;
    const gossip = counts.gossip.real / counts.gossip.total;
    expect(counts.reliable.total).toBeGreaterThan(1000);
    expect(counts.gossip.total).toBeGreaterThan(1000);
    expect(reliable).toBeGreaterThan(0.85);
    expect(reliable).toBeLessThan(0.95);
    expect(gossip).toBeGreaterThan(0.2);
    expect(gossip).toBeLessThan(0.5);
  });
});

describe('страховка заранее', () => {
  it('повторное включение не сдвигает начало, выключение сбрасывает его', () => {
    const world = soloWorld();
    const first = applyAction(world, { type: 'setInsurance', playerId: 'p1', on: true }).world;
    expect(player(first).insuranceFrom).toBe(1 + R.INSURANCE_WAIT_WEEKS);
    first.week++;
    const second = applyAction(first, { type: 'setInsurance', playerId: 'p1', on: true }).world;
    expect(player(second).insuranceFrom).toBe(player(first).insuranceFrom);
    const off = applyAction(second, { type: 'setInsurance', playerId: 'p1', on: false }).world;
    expect(player(off)).toMatchObject({ insured: false, insuranceFrom: null });
    expect(insuranceActive(player(off), 100)).toBe(false);
  });

  it.each([4, 5])('шторм на неделе %i проверяет начало покрытия', (week) => {
    const world = soloWorld();
    world.week = week;
    player(world).insured = true;
    player(world).insuranceFrom = 5;
    const asset = giveAsset(world, 'p1', 'boat');
    world.upcoming = [{ kind: 'storm', week, windowStart: week - 1, announcedWeek: week - 2, real: true, source: 'reliable' }];
    const report = reports(world);
    rollWorldEvent(world, new ChoiceRng(), report);
    expect(asset.damaged).toBe(week < 5);
    expect(report.p1.events[0].id).toBe(week < 5 ? 'stormDamage' : 'stormInsured');
    expect(player(world).goals!.insuredStorm).toBe(week >= 5);
  });

  it('премия платится сразу, лечение покрывается с начала, insuranceStarted приходит один раз', () => {
    const world = soloWorld();
    player(world).insured = true;
    player(world).insuranceFrom = 5;
    vi.spyOn(Rng.prototype, 'chance').mockImplementation((p) => p === R.PERSONAL_EVENT_CHANCE);
    const weighted = Rng.prototype.weighted;
    vi.spyOn(Rng.prototype, 'weighted').mockImplementation(function (this: Rng, weights) {
      return 'illness' in weights ? 'illness' : weighted.call(this, weights);
    });
    for (let week = 1; week <= 6; week++) {
      settleWeek(world, []);
      const r = world.lastReport!.players.p1;
      expect(r.insurance).toBe(R.INSURANCE_BASE);
      expect(r.events.find((e) => e.id === 'illness')!.cashDelta === 0).toBe(week >= 5);
      expect(r.events.some((e) => e.id === 'insuranceStarted')).toBe(week === 5);
    }
  });

  it('оформление после слуха не успевает даже к шторму с максимальным сроком', () => {
    let world = soloWorld();
    world.week = 2; // слух объявлен в конце первой недели
    world.upcoming = [{ kind: 'storm', week: 5, windowStart: 4, announcedWeek: 1, real: true, source: 'reliable' }];
    world = applyAction(world, { type: 'setInsurance', playerId: 'p1', on: true }).world;
    expect(insuranceActive(player(world), 5)).toBe(false);
  });
});

describe('развилки', () => {
  it('нет у ботов, раньше срока, в cooldown и при существующей развилке', () => {
    const world = newWorld();
    generateChoice(world, player(world), new ChoiceRng());
    expect(player(world).choice).toBeNull();
    world.week = 4;
    generateChoice(world, player(world, 'bot-mia'), new ChoiceRng());
    expect(player(world, 'bot-mia').choice).toBeNull();
    generateChoice(world, player(world), new ChoiceRng());
    expect(player(world).choice).toMatchObject({ kind: 'neighborLoan', week: 5 });
    const first = structuredClone(player(world).choice);
    generateChoice(world, player(world), new ChoiceRng('fireSale'));
    expect(player(world).choice).toEqual(first);
    player(world).choice = null;
    world.week++;
    generateChoice(world, player(world), new ChoiceRng());
    expect(player(world).choice).toBeNull();
  });

  it('предпочитает должника ростовщика, иначе беднейшего; сумма кратна десяти', () => {
    const world = newWorld();
    world.week = 4;
    player(world, 'bot-boris').cash = 10;
    generateChoice(world, player(world), new ChoiceRng());
    expect(player(world).choice!.params).toEqual({ neighborId: 'bot-boris', amount: 200 });
    player(world).choice = null;
    player(world).lastChoiceWeek = 0;
    player(world, 'bot-mia').loans = [{ uid: 'l', principal: 100, weeklyRate: R.EMERGENCY_RATE, emergency: true }];
    generateChoice(world, player(world), new ChoiceRng());
    expect(player(world).choice!.params.neighborId).toBe('bot-mia');
  });

  it('отбрасывает недоступные виды и не создаёт развилку при отсутствии вариантов', () => {
    const world = soloWorld();
    world.week = 4;
    const me = player(world);
    me.cash = 0;
    me.employed = false;
    giveAsset(world, 'p1', 'deposit');
    giveAsset(world, 'p1', 'pearlFarm');
    giveAsset(world, 'p1', 'boat', { damaged: true });
    generateChoice(world, me, new ChoiceRng());
    expect(me.choice).toBeNull();
    me.employed = true;
    generateChoice(world, me, new ChoiceRng());
    expect(me.choice).toBeNull();
  });

  it('выдаёт деньги соседу, счастье человеку и срок возврата; нехватка сохраняет развилку', () => {
    const world = newWorld();
    pending(world, 'neighborLoan', { neighborId: 'bot-mia', amount: 200 });
    const result = resolve(world);
    expect(result.error).toBeUndefined();
    const me = player(result.world);
    expect(me.cash).toBe(400);
    expect(player(result.world, 'bot-mia').cash).toBe(800);
    expect(me.happiness).toBe(R.START_HAPPINESS + R.NEIGHBOR_LOAN_JOY);
    expect(me.lent[0]).toMatchObject({ uid: 'c-test', neighborId: 'bot-mia', amount: 200, tries: 0 });
    expect(me.lent[0].dueWeek).toBeGreaterThanOrEqual(1 + R.NEIGHBOR_LOAN_DUE[0]);
    expect(me.lent[0].dueWeek).toBeLessThanOrEqual(1 + R.NEIGHBOR_LOAN_DUE[1]);
    expect(me.choice).toBeNull();
    expect(resolve(world).world).toEqual(result.world);
    player(world).cash = 199;
    expect(choiceView(world, 'p1')).toMatchObject({ canAccept: false, returnAmount: 220, reason: { code: 'notEnoughCash', missing: 1 } });
    expect(resolve(world)).toMatchObject({ world, error: { code: 'notEnoughCash', missing: 1 } });
    expect(player(world).choice).not.toBeNull();
  });

  it('отказ ничего не тратит, нет развилки — noChoice', () => {
    const world = soloWorld();
    expect(resolve(world).error).toEqual({ code: 'noChoice' });
    pending(world, 'fireSale', { neighborId: 'bot-mia', assetUid: 'missing', price: 200 });
    const after = resolve(world, false).world;
    expect(player(after)).toEqual({ ...player(world), choice: null });
  });

  it('предложение покупателя учитывает улучшения, продажу, недельный поток и страховую премию', () => {
    const world = soloWorld();
    world.week = 4;
    const asset = giveAsset(world, 'p1', 'boat', { level: 3, price: 1350, income: 92, upkeep: 31 });
    generateChoice(world, player(world), new ChoiceRng('buyer'));
    const offer = Number(player(world).choice!.params.offer);
    expect(offer).toBe(1620);
    expect(choiceView(world, 'p1')).toMatchObject({ kind: 'buyer', defId: 'boat', level: 3, saleValue: saleValue(asset, world.market), weeklyIncome: currentIncome(asset, world.market, 0) });
    const view = choiceView(world, 'p1');
    const after = resolve(world).world;
    expect(player(after).cash).toBe(R.START_CASH + offer);
    expect(player(after).owned).toEqual([]);
    expect(view).toMatchObject({ freedomAfter: financeView(after, 'p1').freedomRatio });
  });

  it.each(['sold', 'damaged'] as const)('недействительный покупатель (%s): noSuchAsset и снятие', (kind) => {
    const world = soloWorld();
    const asset = giveAsset(world, 'p1', 'boat');
    pending(world, 'buyer', { assetUid: asset.uid, offer: 400 });
    if (kind === 'sold') player(world).owned = [];
    else asset.damaged = true;
    const result = resolve(world);
    expect(result.error).toEqual({ code: 'noSuchAsset' });
    expect(player(result.world).choice).toBeNull();
    expect(player(result.world).cash).toBe(R.START_CASH);
    expect(player(world).choice).not.toBeNull();
  });

  it('в начале расчёта снимает нерешённую развилку без события и последствий', () => {
    const world = soloWorld();
    pending(world, 'fireSale', { neighborId: 'bot-mia', assetUid: 'missing', price: 200 });
    vi.spyOn(Rng.prototype, 'chance').mockReturnValue(false);
    settleWeek(world, []);
    expect(player(world)).toMatchObject({ choice: null, salary: R.SALARY, living: R.LIVING });
  });
});

describe('распродажа у соседа', () => {
  function saleWorld() {
    const world = newWorld();
    world.week = 4;
    const seller = player(world, 'bot-boris');
    seller.cash = R.FIRE_SALE_TROUBLE_CASH - 1;
    const asset = giveAsset(world, seller.id, 'boat', { level: 3, price: 1350, income: 92, upkeep: 31, slotIndex: 3 });
    return { world, seller, asset, me: player(world) };
  }

  it('выбирает беднейшего подходящего, затем должника ростовщика; доступна без денег', () => {
    const { world, me, asset } = saleWorld();
    me.cash = 0;
    player(world, 'bot-timur').cash = 0; // беднее, но нет подходящего актива
    giveAsset(world, 'bot-timur', 'deposit');
    giveAsset(world, 'bot-timur', 'garden');
    giveAsset(world, 'bot-timur', 'boat', { damaged: true });
    generateChoice(world, me, new ChoiceRng('fireSale'));
    expect(me.choice).toMatchObject({ kind: 'fireSale', params: { neighborId: 'bot-boris', assetUid: asset.uid, price: 810 } });
    expect(choiceView(world, 'p1')).toMatchObject({ canAccept: false, reason: { code: 'notEnoughCash', missing: 810 } });
    me.choice = null;
    me.lastChoiceWeek = 0;
    const other = giveAsset(world, 'bot-mia', 'cottage');
    player(world, 'bot-mia').loans = [{ uid: 'l', principal: 100, weeklyRate: R.EMERGENCY_RATE, emergency: true }];
    generateChoice(world, me, new ChoiceRng('fireSale'));
    expect(me.choice!.params).toMatchObject({ neighborId: 'bot-mia', assetUid: other.uid });
  });

  it('нет распродажи у благополучных или при заполненном слоте выбранного актива', () => {
    const { world, me, seller } = saleWorld();
    me.cash = 0;
    seller.cash = R.FIRE_SALE_TROUBLE_CASH;
    generateChoice(world, me, new ChoiceRng('fireSale'));
    expect(me.choice).toBeNull();
    seller.cash--;
    for (let i = 0; i < 4; i++) giveAsset(world, 'p1', 'boat', { slotIndex: i, damaged: true });
    generateChoice(world, me, new ChoiceRng('fireSale'));
    expect(me.choice).toBeNull();
    const cottage = giveAsset(world, seller.id, 'cottage');
    generateChoice(world, me, new ChoiceRng('fireSale'));
    expect(me.choice).toBeNull();
    seller.owned = [cottage];
    generateChoice(world, me, new ChoiceRng('fireSale'));
    expect(me.choice!.params.assetUid).toBe(cottage.uid);
  });

  it('передаёт улучшенный актив, сохраняет его поток, занимает свободное место и платит соседу', () => {
    const { world, me, seller, asset } = saleWorld();
    me.cash = 1000;
    me.insured = true;
    giveAsset(world, 'p1', 'boat', { slotIndex: 0 });
    giveAsset(world, 'p1', 'boat', { slotIndex: 2 });
    generateChoice(world, me, new ChoiceRng('fireSale'));
    const before = JSON.stringify(world);
    const view = choiceView(world, 'p1');
    const income = currentIncome(asset, world.market, me.knowledge);
    expect(view).toMatchObject({ kind: 'fireSale', level: 3, price: 810, usualPrice: 1350, weeklyIncome: income,
      paybackWeeks: Math.ceil(810 / (income - asset.upkeep)), canAccept: true,
      freedomBefore: financeView(world, 'p1').freedomRatio });
    expect(JSON.stringify(world)).toBe(before);
    const result = resolve(world);
    expect(result.error).toBeUndefined();
    expect(player(result.world).owned.at(-1)).toEqual({ ...asset, price: 810, boughtWeek: 4, slotIndex: 1 });
    expect(player(result.world).cash).toBe(190);
    expect(player(result.world, seller.id).cash).toBe(seller.cash + 810);
    expect(player(result.world, seller.id).owned).toEqual([]);
    expect(player(result.world).choice).toBeNull();
    expect(view).toMatchObject({ freedomAfter: financeView(result.world, 'p1').freedomRatio });
    expect(JSON.stringify(world)).toBe(before);
  });

  it.each(['cash', 'slot', 'sold', 'damaged', 'neighbor'] as const)('проверяет изменения к моменту решения: %s', (change) => {
    const { world, me, seller, asset } = saleWorld();
    me.cash = 1000;
    generateChoice(world, me, new ChoiceRng('fireSale'));
    if (change === 'cash') me.cash = 809;
    if (change === 'slot') for (let i = 0; i < 4; i++) giveAsset(world, 'p1', 'boat', { slotIndex: i });
    if (change === 'sold') seller.owned = [];
    if (change === 'damaged') asset.damaged = true;
    if (change === 'neighbor') world.players = world.players.filter((p) => p.id !== seller.id);
    const before = structuredClone(world);
    const result = resolve(world);
    const gone = ['sold', 'damaged', 'neighbor'].includes(change);
    const error = change === 'cash' ? { code: 'notEnoughCash', missing: 1 }
      : change === 'slot' ? { code: 'slotFull', slot: 'pier' } : { code: 'noSuchAsset' };
    expect(result.error).toEqual(error);
    expect(result.world).toEqual(gone ? { ...before, players: before.players.map((p) => p.id === 'p1' ? { ...p, choice: null } : p) } : before);
    if (gone) expect(choiceView(world, 'p1')).toBeNull();
    else expect(choiceView(world, 'p1')).toMatchObject({ canAccept: false, reason: error });
  });

  it('нулевой чистый доход не имеет окупаемости; стратегия соблюдает запас и предел 30 недель', () => {
    const { world, me, seller, asset } = saleWorld();
    world.market.fish = 1;
    asset.income = 20;
    asset.upkeep = 0;
    pending(world, 'fireSale', { neighborId: seller.id, assetUid: asset.uid, price: 600 });
    const decide = (options = {}) => makeSensible(options)(world, me);
    me.cash = 680;
    expect(decide()).toMatchObject({ accept: true });
    expect(decide({ fireSales: false })).toMatchObject({ accept: false });
    me.cash--;
    expect(decide()).toMatchObject({ accept: false });
    me.cash = 1000;
    me.choice!.params.price = 610;
    expect(decide()).toMatchObject({ accept: false });
    asset.upkeep = 20;
    expect(choiceView(world, 'p1')).toMatchObject({ paybackWeeks: null });
    expect(decide()).toMatchObject({ accept: false });
  });
});

describe('возврат соседского займа', () => {
  function loanWorld(cash: number) {
    const world = newWorld();
    player(world, 'bot-mia').cash = cash;
    player(world).lent = [{ uid: 'lent', neighborId: 'bot-mia', amount: 200, dueWeek: 1, tries: 0 }];
    return world;
  }

  it('возвращает с благодарностью при достаточных наличных и не раньше срока', () => {
    const world = loanWorld(320);
    world.week = 0;
    settleLent(world, reports(world));
    expect(player(world).lent).toHaveLength(1);
    world.week = 1;
    const report = reports(world);
    settleLent(world, report);
    expect(player(world).cash).toBe(820);
    expect(player(world, 'bot-mia').cash).toBe(100);
    expect(player(world).lent).toEqual([]);
    expect(report.p1.events).toEqual([{ id: 'neighborLoanReturned', tone: 'good', params: { neighborId: 'bot-mia', amount: 220 }, cashDelta: 220 }]);
  });

  it('отсрочка до новых наличных, после трёх неудач потеря без повторного списания', () => {
    const world = loanWorld(319);
    const report = reports(world);
    for (let attempt = 1; attempt <= R.NEIGHBOR_LOAN_TRIES; attempt++) {
      world.week = 1 + (attempt - 1) * R.NEIGHBOR_LOAN_RETRY;
      settleLent(world, report);
      expect(report.p1.events.at(-1)?.id).toBe(attempt < R.NEIGHBOR_LOAN_TRIES ? 'neighborLoanLate' : 'neighborLoanLost');
      if (attempt < R.NEIGHBOR_LOAN_TRIES) expect(player(world).lent[0]).toMatchObject({ tries: attempt, dueWeek: world.week + R.NEIGHBOR_LOAN_RETRY });
    }
    expect(player(world).cash).toBe(R.START_CASH);
    expect(player(world).lent).toEqual([]);
    const recover = loanWorld(0);
    settleLent(recover, reports(recover));
    recover.week = 3;
    player(recover, 'bot-mia').cash = 400;
    settleLent(recover, reports(recover));
    expect(player(recover).lent).toEqual([]);
    expect(player(recover).cash).toBe(820);
  });

  it('возврат следует после начислений: зарплата позволяет соседу вернуть долг', () => {
    const world = loanWorld(300);
    vi.spyOn(Rng.prototype, 'chance').mockReturnValue(false);
    settleWeek(world, []);
    expect(world.lastReport!.players.p1.events.some((e) => e.id === 'neighborLoanReturned')).toBe(true);
    expect(player(world, 'bot-mia').cash).toBe(110);
    const r = world.lastReport!.players['bot-mia'];
    expect(r.net).toBe(r.salary - r.living + r.eventsCash);
  });
});

describe('цели', () => {
  it('первые три у человека, отсутствуют у ботов', () => {
    const world = newWorld();
    expect(goalsView(world, 'p1')).toMatchObject({ active: GOALS.slice(0, 3).map((g) => ({ id: g.id, reward: g.reward })), done: [], total: GOALS.length });
    for (const bot of world.players.slice(1)) expect(goalsView(world, bot.id)).toBeNull();
  });

  it('награждает один раз, запоминает неделю и выдаёт следующие по порядку', () => {
    const world = soloWorld();
    player(world).knowledge = 1;
    const before = player(world).cash;
    const report = emptyReport();
    settleGoals(world, player(world), report);
    expect(player(world).cash).toBe(before + 90);
    expect(player(world).goals!.done).toEqual([{ id: 'study', week: 1 }, { id: 'cushion', week: 1 }]);
    expect(player(world).goals!.active).toEqual(['sectors', 'passive100', 'upgrade']);
    expect(report.events.map((e) => [e.id, e.params?.goalId, e.cashDelta])).toEqual([['goalDone', 'study', 40], ['goalDone', 'cushion', 50]]);
    settleGoals(world, player(world), report);
    expect(player(world).cash).toBe(before + 90);
  });

  it('debtFree недоступна до кредита, в том числе взятого и погашенного в одну неделю', () => {
    let world = soloWorld();
    player(world).goals!.active = [];
    player(world).goals!.done = GOALS.filter((g) => g.id !== 'debtFree').map((g) => ({ id: g.id, week: 1 }));
    settleGoals(world, player(world), emptyReport());
    expect(player(world).goals!.active).toEqual([]);
    world = applyAction(world, { type: 'takeLoan', playerId: 'p1', amount: 100 }).world;
    const uid = player(world).loans[0].uid;
    world = applyAction(world, { type: 'repayLoan', playerId: 'p1', loanUid: uid, amount: 100 }).world;
    settleGoals(world, player(world), emptyReport());
    expect(player(world).goals!.active).toEqual(['debtFree']);
    settleGoals(world, player(world), emptyReport());
    expect(player(world).goals!.done.at(-1)?.id).toBe('debtFree');
  });

  it('считает все расходы, три настоящих сектора и настоящий пассив; проценты целые', () => {
    const world = soloWorld();
    const me = player(world);
    world.market.fish = world.market.tourism = 1;
    giveAsset(world, 'p1', 'boat', { income: 40 });
    giveAsset(world, 'p1', 'bungalow', { income: 40 });
    giveAsset(world, 'p1', 'pearlFarm', { income: 1000 });
    giveAsset(world, 'p1', 'garden');
    expect(goalProgress(world, me, 'sectors').value).toBe(2);
    expect(goalProgress(world, me, 'passive100').value).toBe(80);
    giveAsset(world, 'p1', 'deposit', { income: 40, level: 2 });
    expect(goalProgress(world, me, 'sectors').value).toBe(3);
    expect(goalProgress(world, me, 'upgrade').value).toBe(1);
    expect(goalProgress(world, me, 'share30').value).toBe(40);
    expect(goalProgress(world, me, 'halfway').value).toBe(Math.round(120 / weeklyExpenses(me).total * 100));
    me.insured = true;
    me.loans = [{ uid: 'l', principal: 100, weeklyRate: R.LOAN_RATE, emergency: false }];
    expect(goalProgress(world, me, 'cushion').target).toBe(3 * weeklyExpenses(me).total);
    expect(goalsView(world, 'p1')!.active.every((g) => Number.isInteger(g.value))).toBe(true);
  });

  it('ростовщик сбрасывает спокойные недели, награда счастья не превышает 100', () => {
    const world = soloWorld();
    const me = player(world);
    me.goals!.calmWeeks = 14;
    me.goals!.active = ['noLoanShark', 'insuredStorm'];
    me.goals!.insuredStorm = true;
    me.happiness = 99;
    const report = emptyReport();
    report.events.push({ id: 'emergencyLoan', tone: 'bad' });
    settleGoals(world, me, report);
    expect(me.goals!.calmWeeks).toBe(0);
    expect(me.goals!.done.map((g) => g.id)).toEqual(['insuredStorm']);
    expect(me.happiness).toBe(100);
    settleGoals(world, me, emptyReport());
    expect(me.goals!.calmWeeks).toBe(1);
  });
});

describe('миграция старых версий → v6', () => {
  it('добавляет поля, сохраняет действующую страховку, вход не меняет', () => {
    const world = newWorld();
    player(world).insured = true;
    world.week = 12;
    const raw = JSON.parse(JSON.stringify(world));
    raw.version = 4;
    delete raw.upcoming;
    for (const p of raw.players) for (const key of ['insuranceFrom', 'choice', 'lastChoiceWeek', 'promotions', 'lent', 'goals']) delete p[key];
    const before = JSON.stringify(raw);
    const migrated = migrateWorld(raw)!;
    expect(JSON.stringify(raw)).toBe(before);
    expect(migrated).toMatchObject({ version: 6, upcoming: [] });
    expect(player(migrated)).toMatchObject({ insuranceFrom: 12, choice: null, lastChoiceWeek: 0, lent: [], goals: { active: ['study', 'cushion', 'sectors'] } });
    expect(player(migrated)).not.toHaveProperty('promotions');
    expect(insuranceActive(player(migrated), 12)).toBe(true);
    expect(migrated.players.slice(1).every((p) => p.goals === null && p.insuranceFrom === null)).toBe(true);
    expect(migrateWorld(migrated)).toEqual(migrated);
  });

  it('v6 сохраняет текущие слухи, развилки и цели; неполный v6 отвергается', () => {
    const world = soloWorld();
    world.upcoming = [{ kind: 'storm', week: 4, windowStart: 3, announcedWeek: 1, real: true, source: 'reliable' }];
    pending(world, 'fireSale', { neighborId: 'bot-mia', assetUid: 'missing', price: 200 });
    expect(migrateWorld(world)).toEqual(world);
    const bad = JSON.parse(JSON.stringify(world));
    delete bad.players[0].insuranceFrom;
    expect(migrateWorld(bad)).toBeNull();
    const badGoals = JSON.parse(JSON.stringify(world));
    badGoals.players[0].goals.active = ['unknown'];
    expect(migrateWorld(badGoals)).toBeNull();
  });

  it.each(['promotion', 'neighborLoan', 'buyer'])('v5 → v6: слухи настоящие и надёжные, развилка %s', (kind) => {
    const raw = JSON.parse(JSON.stringify(newWorld()));
    raw.version = 5;
    raw.upcoming = [{ kind: 'storm', week: 4, windowStart: 3, announcedWeek: 1 }];
    for (const p of raw.players) p.promotions = 1;
    raw.players[0].choice = { uid: 'old', kind, week: 2,
      params: kind === 'promotion' ? { salary: 40, living: 35 } : kind === 'buyer'
        ? { assetUid: 'a', offer: 500 } : { neighborId: 'bot-mia', amount: 200 } };
    const before = structuredClone(raw);
    const migrated = migrateWorld(raw)!;
    expect(raw).toEqual(before);
    expect(migrated.version).toBe(6);
    expect(migrated.upcoming).toEqual([{ ...raw.upcoming[0], real: true, source: 'reliable' }]);
    expect(migrated.players.every((p) => !('promotions' in p))).toBe(true);
    expect(player(migrated).choice).toEqual(kind === 'promotion' ? null : raw.players[0].choice);
    expect(player(migrated).goals).toEqual(raw.players[0].goals);
    expect(migrateWorld(migrated)).toEqual(migrated);
    delete raw.players[0].promotions;
    expect(migrateWorld(raw)).toBeNull();
  });

  it('v6 проверяет источник и правду слуха, сохраняет ложный слух', () => {
    const world = soloWorld();
    world.upcoming = [{ kind: 'crisis', week: 4, windowStart: 3, announcedWeek: 1, real: false, source: 'gossip' }];
    expect(migrateWorld(world)).toEqual(world);
    for (const [key, value] of [['real', undefined], ['real', 1], ['source', undefined], ['source', 'unknown']] as const) {
      const bad = JSON.parse(JSON.stringify(world));
      bad.upcoming[0][key] = value;
      expect(migrateWorld(bad)).toBeNull();
    }
  });
});

describe('стратегии', () => {
  it.each(['crisis', 'fishShoal', 'touristBoom'] as const)('слух %s меняет выбор сделки', (kind) => {
    const world = soloWorld();
    world.offers = [];
    world.market.fish = world.market.tourism = 1;
    player(world).knowledge = 1;
    player(world).cash = 2000;
    const boat = putOffer(world, 'boat');
    const bungalow = putOffer(world, 'bungalow', { price: kind === 'crisis' ? 200 : 600 });
    if (kind !== 'crisis') putOffer(world, 'cottage', { price: 200, income: 100 });
    const baseline = makeSensible()(world, player(world));
    world.upcoming = [{ kind, week: 4, windowStart: 3, announcedWeek: 1, real: true, source: 'reliable' }];
    const listener = makeSensible({ listenRumors: true })(world, player(world));
    const expected = kind === 'touristBoom' ? bungalow.uid : boat.uid;
    expect(listener).toMatchObject({ type: 'buyOffer', offerUid: expected });
    expect(listener).not.toEqual(baseline);
    world.upcoming[0].source = 'gossip';
    expect(makeSensible({ listenRumors: true })(world, player(world))).toEqual(baseline);
  });

  it('разумный проверяет соседский долг, net и собственный запас; щедрый принимает доступный заём', () => {
    const world = newWorld();
    pending(world, 'neighborLoan', { neighborId: 'bot-mia', amount: 200 });
    const decide = (options = {}) => makeSensible(options)(world, player(world));
    expect(decide()).toMatchObject({ type: 'resolveChoice', accept: true });
    player(world, 'bot-mia').loans = [{ uid: 'l', principal: 100, weeklyRate: R.EMERGENCY_RATE, emergency: true }];
    expect(decide()).toMatchObject({ accept: false });
    expect(decide({ lendEveryone: true })).toMatchObject({ accept: true });
    player(world, 'bot-mia').loans = [];
    player(world, 'bot-mia').living = 1000;
    expect(decide()).toMatchObject({ accept: false });
    player(world, 'bot-mia').living = R.LIVING;
    player(world).cash = 349;
    expect(decide()).toMatchObject({ accept: false });
  });

  it('разумный продаёт за 25 недель дохода', () => {
    const world = soloWorld();
    world.market.fish = 1;
    const asset = giveAsset(world, 'p1', 'boat', { income: 20 });
    pending(world, 'buyer', { assetUid: asset.uid, offer: 500 });
    expect(makeSensible()(world, player(world))).toMatchObject({ accept: true });
    player(world).choice!.params.offer = 490;
    expect(makeSensible()(world, player(world))).toMatchObject({ accept: false });
  });
});
