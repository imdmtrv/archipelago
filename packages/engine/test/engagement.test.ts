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
    expect(world.upcoming).toEqual([{ kind: 'storm', week: 3, windowStart: 3, announcedWeek: 1 }]);
    for (const p of world.players) {
      expect(report[p.id].events[0]).toMatchObject({ id: 'rumor', tone: 'neutral', params: { kind: 'storm', fromWeek: 3, toWeek: 4 } });
      expect(report[p.id].events[0].params?.exactWeek).toBe(p.knowledge >= R.RUMOR_EXACT_KNOWLEDGE ? 3 : undefined);
    }
    rollWorldEvent(world, new ChoiceRng(), report);
    expect(world.upcoming).toHaveLength(1);
    expect(report.p1.events).toHaveLength(1);
  });

  it('представления отсортированы, точность зависит от знаний, чтение не меняет мир', () => {
    const world = soloWorld();
    world.upcoming = [
      { kind: 'crisis', week: 5, windowStart: 4, announcedWeek: 1 },
      { kind: 'fishShoal', week: 3, windowStart: 3, announcedWeek: 1 },
    ];
    const before = JSON.stringify(world);
    expect(rumorViews(world, 'p1').map((r) => [r.kind, r.exactWeek])).toEqual([['fishShoal', null], ['crisis', null]]);
    expect(JSON.stringify(world)).toBe(before);
    player(world).knowledge = R.RUMOR_EXACT_KNOWLEDGE;
    expect(rumorViews(world, 'p1').map((r) => r.exactWeek)).toEqual([3, 5]);
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
    world.upcoming = [{ kind, week: 1, windowStart: 1, announcedWeek: -1 }];
    vi.spyOn(Rng.prototype, 'chance').mockReturnValue(false);
    expect(rollWorldEvent(world, new Rng(0), reports(world))[0].id).toBe(kind);
    expect(world.market.fishShock).toBe(kind === 'fishShoal' ? R.SHOAL_FISH_SHOCK : kind === 'crisis' ? R.CRISIS_FISH_SHOCK : 0);
    expect(world.market.tourismShock).toBe(kind === 'touristBoom' ? R.BOOM_TOURISM_SHOCK : kind === 'crisis' ? R.CRISIS_TOURISM_SHOCK : 0);
    expect(world.upcoming).toEqual([]);
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
    world.upcoming = [{ kind: 'storm', week, windowStart: week - 1, announcedWeek: week - 2 }];
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
    world.upcoming = [{ kind: 'storm', week: 5, windowStart: 4, announcedWeek: 1 }];
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
    generateChoice(world, player(world), new ChoiceRng('promotion'));
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
    me.promotions = R.PROMOTION_MAX;
    generateChoice(world, me, new ChoiceRng());
    expect(me.choice).toBeNull();
    me.promotions = 0;
    generateChoice(world, me, new ChoiceRng('neighborLoan'));
    expect(me.choice!.kind).toBe('promotion');
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
    pending(world, 'promotion', { salary: R.PROMOTION_SALARY, living: R.PROMOTION_LIVING });
    const after = resolve(world, false).world;
    expect(player(after)).toEqual({ ...player(world), choice: null });
  });

  it('повышение меняет расходы и зарплату; представление считает свободу как financeView', () => {
    const world = soloWorld();
    giveAsset(world, 'p1', 'boat');
    pending(world, 'promotion', { salary: R.PROMOTION_SALARY, living: R.PROMOTION_LIVING });
    const view = choiceView(world, 'p1');
    const after = resolve(world).world;
    expect(player(after)).toMatchObject({ salary: R.SALARY + R.PROMOTION_SALARY, living: R.LIVING + R.PROMOTION_LIVING, promotions: 1 });
    expect(view).toMatchObject({ netChange: 5, freedomBefore: financeView(world, 'p1').freedomRatio, freedomAfter: financeView(after, 'p1').freedomRatio });
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
    pending(world, 'promotion', { salary: 40, living: 35 });
    vi.spyOn(Rng.prototype, 'chance').mockReturnValue(false);
    settleWeek(world, []);
    expect(player(world)).toMatchObject({ choice: null, promotions: 0, salary: R.SALARY, living: R.LIVING });
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

describe('миграция v4 → v5', () => {
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
    expect(migrated).toMatchObject({ version: 5, upcoming: [] });
    expect(player(migrated)).toMatchObject({ insuranceFrom: 12, choice: null, lastChoiceWeek: 0, promotions: 0, lent: [], goals: { active: ['study', 'cushion', 'sectors'] } });
    expect(insuranceActive(player(migrated), 12)).toBe(true);
    expect(migrated.players.slice(1).every((p) => p.goals === null && p.insuranceFrom === null)).toBe(true);
    expect(migrateWorld(migrated)).toEqual(migrated);
  });

  it('v5 сохраняет текущие слухи, развилки и цели; неполный v5 отвергается', () => {
    const world = soloWorld();
    world.upcoming = [{ kind: 'storm', week: 4, windowStart: 3, announcedWeek: 1 }];
    pending(world, 'promotion', { salary: 40, living: 35 });
    expect(migrateWorld(world)).toEqual(world);
    const bad = JSON.parse(JSON.stringify(world));
    delete bad.players[0].insuranceFrom;
    expect(migrateWorld(bad)).toBeNull();
    const badGoals = JSON.parse(JSON.stringify(world));
    badGoals.players[0].goals.active = ['unknown'];
    expect(migrateWorld(badGoals)).toBeNull();
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
    world.upcoming = [{ kind, week: 4, windowStart: 3, announcedWeek: 1 }];
    const listener = makeSensible({ listenRumors: true })(world, player(world));
    const expected = kind === 'touristBoom' ? bungalow.uid : boat.uid;
    expect(listener).toMatchObject({ type: 'buyOffer', offerUid: expected });
    expect(listener).not.toEqual(baseline);
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

  it('разумный отказывается от переезда и продаёт за 25 недель дохода', () => {
    const world = soloWorld();
    pending(world, 'promotion', { salary: 40, living: 35 });
    expect(makeSensible()(world, player(world))).toMatchObject({ accept: false });
    expect(makeSensible({ alwaysPromote: true })(world, player(world))).toMatchObject({ accept: true });
    world.market.fish = 1;
    const asset = giveAsset(world, 'p1', 'boat', { income: 20 });
    pending(world, 'buyer', { assetUid: asset.uid, offer: 500 });
    expect(makeSensible()(world, player(world))).toMatchObject({ accept: true });
    player(world).choice!.params.offer = 490;
    expect(makeSensible()(world, player(world))).toMatchObject({ accept: false });
  });
});
