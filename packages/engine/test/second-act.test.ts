// Второй акт: уход с работы, мечта-шхуна, свобода под угрозой, уровни свободы, миграция сохранений.
import { describe, expect, it } from 'vitest';
import { runBots } from '../src/bots';
import { DREAMS } from '../src/content';
import { DREAM_UPKEEP_UID, freedomLevel, isFree, weeklyExpenses } from '../src/economy';
import { rollPersonalEvent } from '../src/events';
import { migrateWorld } from '../src/migrate';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import * as R from '../src/rules';
import { dreamView, financeView, getPlayer, offerViews } from '../src/selectors';
import type { Action, GameEvent, WorldState } from '../src/types';
import { settleWeek } from '../src/week';
import { badNumbers, deepFreeze, giveAsset, newWorld, player, putOffer, soloWorld } from './helpers';

// ───────────── Вспомогательное ─────────────

function ok(world: WorldState, action: Action): WorldState {
  const result = applyAction(world, action);
  expect(result.error, action.type).toBeUndefined();
  return result.world;
}

function endWeek(world: WorldState): WorldState {
  return ok(world, { type: 'endWeek' });
}

function eventsOf(world: WorldState, id: string, playerId = 'p1'): GameEvent[] {
  return world.lastReport!.players[playerId].events.filter((e) => e.id === id);
}

function actionOf(type: 'quitJob' | 'returnToWork' | 'buildDream'): Action {
  return { type, playerId: 'p1' };
}

/**
 * Свободный человек один на острове: вклад с большим доходом, много монет.
 * Свобода и высший уровень уже отмечены, чтобы лишние события не мешали проверкам.
 */
function freeWorld(opts: { employed?: boolean; income?: number; cash?: number } = {}): WorldState {
  const world = soloWorld();
  const p = player(world);
  giveAsset(world, 'p1', 'deposit', { income: opts.income ?? 1000 });
  p.cash = opts.cash ?? 5000;
  p.freedomWeek = 1;
  p.bestLevel = 3;
  p.employed = opts.employed ?? true;
  return world;
}

/** ГПСЧ по сценарию: отдаёт заранее заданные числа и считает обращения. */
class ScriptedRng extends Rng {
  draws = 0;
  constructor(private readonly values: number[]) {
    super(1);
  }
  override next(): number {
    return this.values[this.draws++] ?? 0.5;
  }
}

// ───────────── Уход с работы и возвращение ─────────────

describe('уход с работы', () => {
  it('до свободы уйти нельзя', () => {
    const world = soloWorld();
    const result = applyAction(world, actionOf('quitJob'));
    expect(result.error).toEqual({ code: 'quitBeforeFreedom' });
    expect(result.world).toBe(world);
  });

  it('после свободы можно: работа снимается вместе с подработкой и счётчиком угрозы', () => {
    let world = freeWorld();
    player(world).extraShift = true;
    player(world).threatWeeks = 2;
    world = ok(world, actionOf('quitJob'));
    expect(player(world)).toMatchObject({ employed: false, extraShift: false, threatWeeks: 0, salary: 180 });
  });

  it('второй раз подряд — отказ', () => {
    const world = ok(freeWorld(), actionOf('quitJob'));
    expect(applyAction(world, actionOf('quitJob')).error).toEqual({ code: 'alreadyQuit' });
  });

  it('вернуться, пока работаешь, нельзя', () => {
    expect(applyAction(freeWorld(), actionOf('returnToWork')).error).toEqual({ code: 'alreadyEmployed' });
  });

  it('возвращение режет зарплату до ближайших 5 и сбрасывает угрозу', () => {
    let world = ok(freeWorld(), actionOf('quitJob'));
    player(world).threatWeeks = 3;
    world = ok(world, actionOf('returnToWork'));
    // 180 × 0.85 = 153 → 155
    expect(player(world)).toMatchObject({ employed: true, threatWeeks: 0, salary: 155 });
    // и ещё раз: 155 × 0.85 = 131,75 → 130
    world = ok(ok(world, actionOf('quitJob')), actionOf('returnToWork'));
    expect(player(world).salary).toBe(130);
  });

  it('зарплата после возвращения не опускается ниже 5', () => {
    for (const salary of [1, 3, 5]) {
      const world = ok(freeWorld(), actionOf('quitJob'));
      player(world).salary = salary;
      expect(player(ok(world, actionOf('returnToWork'))).salary).toBe(5);
    }
  });

  it('финансовая картина: без работы зарплаты нет', () => {
    const world = ok(freeWorld(), actionOf('quitJob'));
    const view = financeView(world, 'p1');
    expect(view).toMatchObject({ salary: 0, employed: false });
    expect(view.net).toBe(view.passiveIncome - view.expenses.total);
    expect(financeView(freeWorld(), 'p1')).toMatchObject({ salary: 180, employed: true });
  });
});

describe('жизнь без работы', () => {
  it('нет зарплаты: отчёт недели сходится с наличными', () => {
    let world = ok(freeWorld(), actionOf('quitJob'));
    const before = player(world).cash;
    world = endWeek(world);
    const r = world.lastReport!.players.p1;
    expect(r.salary).toBe(0);
    expect(r.net).toBe(1000 - 150 + r.eventsCash);
    expect(r.cashAfter).toBe(before + r.net);
    expect(player(world).cash).toBe(r.cashAfter);
  });

  it('будни не отнимают счастье, а работающему — отнимают', () => {
    const free = endWeek(ok(freeWorld(), actionOf('quitJob')));
    expect(free.lastReport!.players.p1.happinessDelta).toBe(0);
    expect(player(free).happiness).toBe(70);
    const busy = endWeek(freeWorld());
    expect(busy.lastReport!.players.p1.happinessDelta).toBe(R.HAPPINESS_DRIFT);
  });

  it('подработку взять нельзя, а выключить — можно', () => {
    const world = ok(freeWorld(), actionOf('quitJob'));
    const result = applyAction(world, { type: 'setExtraShift', playerId: 'p1', on: true });
    expect(result.error).toEqual({ code: 'shiftUnemployed' });
    expect(result.world).toBe(world);
    ok(world, { type: 'setExtraShift', playerId: 'p1', on: false });
  });

  it('выгорания нет, даже когда сил совсем нет', () => {
    let world = ok(freeWorld(), actionOf('quitJob'));
    for (let i = 0; i < 40; i++) {
      player(world).happiness = 0;
      world = endWeek(world);
      expect(eventsOf(world, 'burnout')).toEqual([]);
      expect(world.lastReport!.players.p1.salary).toBe(0);
    }
    // контроль: на работе при нулевом счастье выгорание неизбежно
    const busy = freeWorld();
    player(busy).happiness = 0;
    const after = endWeek(busy);
    expect(eventsOf(after, 'burnout')).toHaveLength(1);
    expect(after.lastReport!.players.p1.salary).toBe(90);
  });

  it('выгорание не тратит случайные числа без работы', () => {
    const run = (employed: boolean) => {
      const world = freeWorld({ employed });
      player(world).happiness = 0;
      return endWeek(world).rng;
    };
    // у работающего бросок выгорания сдвигает ГПСЧ, у безработного — нет
    expect(run(true)).not.toBe(run(false));
  });

  it('повышения без работы не бывает: числа бросаются те же, но события нет', () => {
    // 0 → «событие случилось», 0.95 → выбран последний вид (повышение)
    const busy = freeWorld();
    const busyRng = new ScriptedRng([0, 0.9]);
    const raise = rollPersonalEvent(player(busy), busyRng);
    expect(raise?.id).toBe('raise');
    expect(player(busy)).toMatchObject({ salary: 180 + R.RAISE_SALARY, living: 150 + R.RAISE_LIVING });

    const jobless = ok(freeWorld(), actionOf('quitJob'));
    const joblessRng = new ScriptedRng([0, 0.9]);
    expect(rollPersonalEvent(player(jobless), joblessRng)).toBeNull();
    expect(player(jobless)).toMatchObject({ salary: 180, living: 150 });
    expect(joblessRng.draws).toBe(busyRng.draws);
  });

  it('за 200 недель без работы ни одного повышения', () => {
    let world = ok(freeWorld(), actionOf('quitJob'));
    for (let i = 0; i < 200; i++) {
      world = endWeek(world);
      expect(eventsOf(world, 'raise')).toEqual([]);
    }
    expect(player(world)).toMatchObject({ salary: 180, living: 150 });
    // контроль: на работе повышения случаются
    let busy = freeWorld();
    let raises = 0;
    for (let i = 0; i < 200; i++) {
      busy = endWeek(busy);
      raises += eventsOf(busy, 'raise').length;
    }
    expect(raises).toBeGreaterThan(0);
  });
});

// ───────────── Мечта ─────────────

describe('постройка мечты: начало этапа', () => {
  it('у человека мечта есть с первой недели, у соседей — нет', () => {
    const world = newWorld();
    expect(dreamView(world, 'p1')).not.toBeNull();
    expect(dreamView(world, 'bot-mia')).toBeNull();
    const result = applyAction(world, { type: 'buildDream', playerId: 'bot-mia' });
    expect(result.error).toEqual({ code: 'noDream' });
    expect(result.world).toBe(world);
  });

  it('до свободы строить нельзя', () => {
    const world = soloWorld();
    player(world).cash = 5000;
    expect(applyAction(world, actionOf('buildDream')).error).toEqual({ code: 'dreamBeforeFreedom' });
  });

  it('не хватает монет — понятная ошибка с суммой', () => {
    const world = freeWorld({ cash: 399 });
    expect(applyAction(world, actionOf('buildDream')).error).toEqual({ code: 'notEnoughCash', missing: 1 });
    player(world).cash = 100;
    expect(applyAction(world, actionOf('buildDream')).error).toEqual({ code: 'notEnoughCash', missing: 300 });
  });

  it('плата списывается, этап начинает строиться', () => {
    const world = ok(freeWorld({ cash: 1000 }), actionOf('buildDream'));
    expect(player(world).cash).toBe(1000 - DREAMS.schooner.stages[0].cost);
    expect(player(world).dream).toMatchObject({ built: 0, building: true, progress: 0, doneWeek: null });
  });

  it('пока этап строится, второй не начать — даже без денег', () => {
    const world = ok(freeWorld(), actionOf('buildDream'));
    player(world).cash = 0;
    const result = applyAction(world, actionOf('buildDream'));
    expect(result.error).toEqual({ code: 'dreamBusy' });
    expect(result.world).toBe(world);
  });

  it('готовая мечта: строить больше нечего', () => {
    const world = freeWorld();
    Object.assign(player(world).dream!, { built: 3, building: false, doneWeek: 5 });
    expect(applyAction(world, actionOf('buildDream')).error).toEqual({ code: 'dreamDone' });
  });

  it('коды ошибок второго акта стабильны', () => {
    expect(applyAction(soloWorld(), actionOf('quitJob')).error).toEqual({ code: 'quitBeforeFreedom' });
    expect(applyAction(soloWorld(), actionOf('buildDream')).error).toEqual({ code: 'dreamBeforeFreedom' });
  });
});

describe('постройка мечты: ход работ', () => {
  it('на работе — 1 день в неделю: первый этап (4 дня) за 4 недели', () => {
    let world = ok(freeWorld(), actionOf('buildDream'));
    for (let day = 1; day <= 3; day++) {
      world = endWeek(world);
      expect(player(world).dream).toMatchObject({ built: 0, building: true, progress: day });
      expect(eventsOf(world, 'dreamStage')).toEqual([]);
    }
    world = endWeek(world);
    expect(player(world).dream).toMatchObject({ built: 1, building: false, progress: 0, doneWeek: null });
    const [stageEvent] = eventsOf(world, 'dreamStage');
    expect(stageEvent.params).toMatchObject({ dreamId: 'schooner', finishedStage: 0, nextStage: 1 });
    expect(stageEvent.tone).toBe('good');
    expect(eventsOf(world, 'dreamDone')).toEqual([]);
  });

  it('без работы — 3 дня в неделю: первый этап за 2 недели', () => {
    let world = ok(ok(freeWorld(), actionOf('quitJob')), actionOf('buildDream'));
    world = endWeek(world);
    expect(player(world).dream).toMatchObject({ built: 0, building: true, progress: 3 });
    world = endWeek(world);
    expect(player(world).dream).toMatchObject({ built: 1, building: false, progress: 0 });
    expect(eventsOf(world, 'dreamStage')[0].params).toMatchObject({ finishedStage: 0 });
  });

  it('скорость зависит от того, работает ли игрок в эту неделю', () => {
    let world = ok(freeWorld(), actionOf('buildDream'));
    world = endWeek(world); // на работе: +1
    world = ok(world, actionOf('quitJob'));
    world = endWeek(world); // без работы: +3 → 4 дня, этап готов
    expect(player(world).dream).toMatchObject({ built: 1, building: false });
  });

  it('все три этапа: события по пути, мечта готова, неделя запоминается, выходит новость', () => {
    let world = ok(freeWorld(), actionOf('quitJob'));
    const finishedStages: number[] = [];
    for (let stage = 0; stage < 3; stage++) {
      world = ok(world, actionOf('buildDream'));
      expect(dreamView(world, 'p1')!.stage).toBe(DREAMS.schooner.stages[stage]);
      while (player(world).dream!.building) {
        world = endWeek(world);
        finishedStages.push(...eventsOf(world, 'dreamStage').map((e) => Number(e.params?.finishedStage)));
      }
    }
    expect(finishedStages).toEqual([0, 1]);
    const dream = player(world).dream!;
    expect(dream).toMatchObject({ built: 3, building: false, progress: 0 });
    expect(dream.doneWeek).toBe(world.lastReport!.week);

    const [done] = eventsOf(world, 'dreamDone');
    expect(done.tone).toBe('good');
    expect(done.params).toEqual({ dreamId: 'schooner', upkeep: DREAMS.schooner.upkeep });
    expect(world.lastReport!.news).toContainEqual({ playerId: 'p1', kind: 'dreamDone' });
    expect(applyAction(world, actionOf('buildDream')).error).toEqual({ code: 'dreamDone' });
  });
});

describe('готовая мечта', () => {
  /** Человек без работы, мечта готова с прошлой недели, счастье с запасом, чтобы не упереться в 100. */
  function dreamWorld(employed = false): WorldState {
    const world = freeWorld({ employed });
    Object.assign(player(world).dream!, { built: 3, building: false, doneWeek: 1 });
    player(world).happiness = 50;
    return world;
  }

  it('в неделю завершения мечта ещё не стоит денег — только со следующей', () => {
    let world = ok(ok(freeWorld(), actionOf('quitJob')), actionOf('buildDream'));
    // третий этап (6 дней) уже набрал 3 дня: ещё неделя без работы — и шхуна готова
    Object.assign(player(world).dream!, { built: 2, building: true, progress: 3 });
    world = endWeek(world);
    expect(player(world).dream!.doneWeek).toBe(1);
    const first = world.lastReport!.players.p1;
    expect(first.upkeep.find((u) => u.assetUid === DREAM_UPKEEP_UID)).toBeUndefined();
    world = endWeek(world);
    expect(world.lastReport!.players.p1.upkeep.find((u) => u.assetUid === DREAM_UPKEEP_UID)).toBeDefined();
  });

  it('содержание попадает в расходы, отчёт и сходится с наличными', () => {
    let world = dreamWorld();
    const expenses = weeklyExpenses(player(world));
    expect(expenses).toMatchObject({ living: 150, upkeep: 20, total: 170 });
    expect(financeView(world, 'p1').expenses.upkeep).toBe(20);
    const cashBefore = player(world).cash;
    world = endWeek(world);
    const r = world.lastReport!.players.p1;
    expect(r.upkeep).toEqual([{ assetUid: 'dream', amount: 20 }]);
    expect(r.net).toBe(r.salary + 1000 - 20 - 150 + r.eventsCash);
    expect(r.cashAfter).toBe(cashBefore + r.net);
  });

  it('содержание считается и в свободе: мечта съедает запас', () => {
    const world = dreamWorld();
    player(world).owned[0].income = 160; // 160 ≥ 150 + 20? нет
    expect(isFree(player(world), world.market)).toBe(false);
    player(world).owned[0].income = 170;
    expect(isFree(player(world), world.market)).toBe(true);
    player(world).dream!.doneWeek = null; // без готовой мечты содержания нет
    player(world).owned[0].income = 150;
    expect(isFree(player(world), world.market)).toBe(true);
  });

  it('радость мечты прибавляется к счастью каждую неделю', () => {
    const jobless = endWeek(dreamWorld());
    expect(jobless.lastReport!.players.p1.happinessDelta).toBe(DREAMS.schooner.joy);
    expect(player(jobless).happiness).toBe(50 + DREAMS.schooner.joy);
    const busy = endWeek(dreamWorld(true));
    expect(busy.lastReport!.players.p1.happinessDelta).toBe(R.HAPPINESS_DRIFT + DREAMS.schooner.joy);
  });

  it('шхуна — не имущество: капитал от готовой мечты не меняется', () => {
    const world = freeWorld();
    const before = financeView(world, 'p1').netWorth;
    Object.assign(player(world).dream!, { built: 3, doneWeek: 4 });
    expect(financeView(world, 'p1').netWorth).toBe(before);
    expect(before).toBe(player(world).cash + 400);
  });
});

// ───────────── Свобода под угрозой ─────────────

describe('свобода под угрозой', () => {
  /** Без работы, без пассивного дохода: свободы нет. */
  function exposedWorld(): WorldState {
    const world = ok(freeWorld(), actionOf('quitJob'));
    player(world).owned = [];
    return world;
  }

  it('недели без свободы считаются, события предупреждают; на четвёртой — возврат на работу', () => {
    let world = exposedWorld();
    const expectedLeft = [3, 2, 1];
    for (let week = 1; week <= 3; week++) {
      world = endWeek(world);
      expect(player(world)).toMatchObject({ employed: false, threatWeeks: week });
      const [threat] = eventsOf(world, 'freedomThreat');
      expect(threat.tone).toBe('bad');
      expect(threat.params).toEqual({ weeksLeft: expectedLeft[week - 1] });
      expect(world.lastReport!.players.p1.salary).toBe(0);
    }
    world = endWeek(world);
    expect(player(world)).toMatchObject({ employed: true, threatWeeks: 0, salary: 155 });
    expect(eventsOf(world, 'freedomThreat')).toEqual([]);
    const [back] = eventsOf(world, 'backToWork');
    expect(back.tone).toBe('bad');
    expect(back.params).toEqual({ salary: 155 });
    // свободу «навсегда» это не отменяет: она была достигнута
    expect(player(world).freedomWeek).toBe(1);

    // следующая неделя — снова с зарплатой, новой, меньшей
    world = endWeek(world);
    expect(world.lastReport!.players.p1.salary).toBe(155);
    expect(eventsOf(world, 'freedomThreat')).toEqual([]);
  });

  it('число оставшихся недель передаётся данными', () => {
    const left: number[] = [];
    let world = exposedWorld();
    for (let week = 1; week <= 3; week++) {
      world = endWeek(world);
      left.push(Number(eventsOf(world, 'freedomThreat')[0].params?.weeksLeft));
    }
    expect(left).toEqual([3, 2, 1]);
  });

  it('вернулись вовремя: свобода снова на месте — угроза миновала, счётчик сброшен', () => {
    let world = exposedWorld();
    world = endWeek(endWeek(world));
    expect(player(world).threatWeeks).toBe(2);
    giveAsset(world, 'p1', 'deposit', { income: 400 });
    world = endWeek(world);
    expect(player(world)).toMatchObject({ employed: false, threatWeeks: 0 });
    const [over] = eventsOf(world, 'threatOver');
    expect(over.tone).toBe('good');
    expect(over.params).toEqual({});
    expect(eventsOf(world, 'backToWork')).toEqual([]);

    // дальше тихо: угроза миновала один раз
    world = endWeek(world);
    expect(eventsOf(world, 'threatOver')).toEqual([]);
  });

  it('счётчик не копится зря: свободному без работы события не приходят', () => {
    let world = ok(freeWorld(), actionOf('quitJob'));
    for (let i = 0; i < 10; i++) {
      world = endWeek(world);
      expect(eventsOf(world, 'freedomThreat')).toEqual([]);
      expect(eventsOf(world, 'threatOver')).toEqual([]);
    }
    expect(player(world)).toMatchObject({ employed: false, threatWeeks: 0 });
  });

  it('работающему угроза не грозит, даже если пассивный доход мал', () => {
    let world = freeWorld();
    player(world).owned = [];
    for (let i = 0; i < 6; i++) {
      world = endWeek(world);
      expect(eventsOf(world, 'freedomThreat')).toEqual([]);
    }
    expect(player(world)).toMatchObject({ employed: true, threatWeeks: 0 });
  });

  it('ровно впритык к расходам — ещё свобода; готовая мечта выбивает из неё', () => {
    const world = ok(freeWorld({ income: 150 }), actionOf('quitJob'));
    let calm = endWeek(world);
    expect(eventsOf(calm, 'freedomThreat')).toEqual([]);

    Object.assign(player(world).dream!, { built: 3, building: false, doneWeek: 1 });
    calm = endWeek(world);
    expect(eventsOf(calm, 'freedomThreat')).toHaveLength(1);
    expect(player(calm).threatWeeks).toBe(1);
  });

  it('возврат по собственной воле и по угрозе режет зарплату одинаково', () => {
    const own = ok(ok(freeWorld(), actionOf('quitJob')), actionOf('returnToWork'));
    let forced = exposedWorld();
    for (let i = 0; i < R.THREAT_WEEKS; i++) forced = endWeek(forced);
    expect(player(forced).salary).toBe(player(own).salary);
  });
});

// ───────────── Уровни свободы ─────────────

describe('уровни свободы', () => {
  it('freedomLevel: пороги 100%, 150%, 200%', () => {
    expect(R.FREEDOM_LEVEL_RATIOS).toEqual([1, 1.5, 2]);
    const levels = [0, 0.99, 1, 1.49, 1.5, 1.99, 2, 10].map(freedomLevel);
    expect(levels).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  /** Безработный свободный: повышения исключены, поэтому расходы стоят на месте и пороги точные. */
  function levelWorld(income: number): WorldState {
    const world = ok(freeWorld({ income }), actionOf('quitJob'));
    player(world).bestLevel = 1;
    return world;
  }

  function setIncome(world: WorldState, income: number): void {
    player(world).owned[0].income = income;
  }

  it('ступени отмечаются по одной: 150% — «Уверенность», 200% — «Богатство»', () => {
    let world = levelWorld(150); // ровно 100%
    world = endWeek(world);
    expect(player(world).bestLevel).toBe(1);
    expect(eventsOf(world, 'freedomLevel')).toEqual([]);

    setIncome(world, 225); // ровно 150%
    world = endWeek(world);
    expect(player(world).bestLevel).toBe(2);
    const [mid] = eventsOf(world, 'freedomLevel');
    expect(mid).toMatchObject({ tone: 'good', params: { level: 2 } });

    setIncome(world, 300); // ровно 200%
    world = endWeek(world);
    expect(player(world).bestLevel).toBe(3);
    const [top] = eventsOf(world, 'freedomLevel');
    expect(top).toMatchObject({ tone: 'good', params: { level: 3 } });
  });

  it('уровень отмечается один раз: падение и новый подъём не празднуются заново', () => {
    let world = levelWorld(300);
    world = endWeek(world);
    expect(player(world).bestLevel).toBe(3);

    setIncome(world, 150);
    world = endWeek(world);
    expect(financeView(world, 'p1').level).toBe(1);
    expect(player(world).bestLevel).toBe(3);

    setIncome(world, 300);
    world = endWeek(world);
    expect(eventsOf(world, 'freedomLevel')).toEqual([]);
  });

  it('рывок через несколько уровней даёт одно событие — за высший', () => {
    const world = levelWorld(300);
    player(world).bestLevel = 0;
    const after = endWeek(world);
    expect(player(after).bestLevel).toBe(3);
    const events = eventsOf(after, 'freedomLevel');
    expect(events.map((e) => e.params?.level)).toEqual([3]);
  });

  it('первый уровень празднует обычное событие свободы, а не уровень', () => {
    let world = soloWorld();
    giveAsset(world, 'p1', 'deposit', { income: 160 }); // ≈107%: свобода есть, запаса нет
    world = endWeek(world);
    expect(player(world).freedomWeek).toBe(1);
    expect(player(world).bestLevel).toBe(1);
    expect(eventsOf(world, 'freedom')).toHaveLength(1);
    expect(eventsOf(world, 'freedomLevel')).toEqual([]);
  });

  it('афера не поднимает уровень: считается настоящий доход', () => {
    let world = ok(freeWorld({ income: 150 }), actionOf('quitJob'));
    player(world).bestLevel = 1;
    giveAsset(world, 'p1', 'pearlFarm', { income: 1000, collapseWeek: 50 });
    world = endWeek(world);
    expect(player(world).bestLevel).toBe(1);
    expect(financeView(world, 'p1').level).toBeGreaterThan(1); // шкала афере верит, уровень — нет
    expect(eventsOf(world, 'freedomLevel')).toEqual([]);
  });

  it('у соседей-ботов уровни тоже считаются', () => {
    let world = newWorld(3);
    giveAsset(world, 'bot-mia', 'deposit', { income: 400 });
    world = endWeek(world);
    expect(getPlayer(world, 'bot-mia').bestLevel).toBe(3);
    expect(getPlayer(world, 'p1').bestLevel).toBe(0);
  });
});

// ───────────── Селекторы ─────────────

describe('свобода после покупки', () => {
  it('доходный актив поднимает шкалу, статусная вещь — опускает', () => {
    const world = soloWorld();
    giveAsset(world, 'p1', 'cottage', { income: 38, upkeep: 6 });
    const cottage = putOffer(world, 'cottage', { price: 700, income: 38, upkeep: 6 });
    const statue = putOffer(world, 'statue');
    const now = financeView(world, 'p1').freedomRatio;
    expect(now).toBeCloseTo(38 / 156, 6);

    const views = offerViews(world, 'p1');
    const afterCottage = views.find((v) => v.offer.uid === cottage.uid)!.freedomAfter;
    const afterStatue = views.find((v) => v.offer.uid === statue.uid)!.freedomAfter;
    expect(afterCottage).toBeCloseTo(76 / 162, 6);
    expect(afterCottage).toBeGreaterThan(now);
    expect(afterStatue).toBeCloseTo(38 / 168, 6);
    expect(afterStatue).toBeLessThan(now);
  });

  it('совпадает с шкалой после настоящей покупки (в том числе со страховкой)', () => {
    let world = soloWorld();
    player(world).cash = 5000;
    player(world).insured = true;
    giveAsset(world, 'p1', 'boat');
    const offer = putOffer(world, 'bungalow');
    const predicted = offerViews(world, 'p1').find((v) => v.offer.uid === offer.uid)!.freedomAfter;
    world = ok(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid });
    expect(financeView(world, 'p1').freedomRatio).toBeCloseTo(predicted, 9);
  });

  it('не меняет мир и работает на замороженном мире', () => {
    const world = soloWorld();
    putOffer(world, 'boat');
    giveAsset(world, 'p1', 'cottage');
    const snapshot = JSON.stringify(world);
    deepFreeze(world);
    expect(() => offerViews(world, 'p1')).not.toThrow();
    expect(JSON.stringify(world)).toBe(snapshot);
  });
});

describe('вид мечты', () => {
  it('в начале: этап 1, работая 1 день в неделю, до свободы начать нельзя', () => {
    const world = soloWorld();
    const view = dreamView(world, 'p1')!;
    expect(view.def).toBe(DREAMS.schooner);
    expect(view.state).toEqual({ id: 'schooner', built: 0, building: false, progress: 0, doneWeek: null });
    expect(view.stage).toBe(DREAMS.schooner.stages[0]);
    expect(view).toMatchObject({ stageIndex: 0, workPerWeek: 1, weeksLeft: 4, canStart: false });
    expect(view.reason).toBe('beforeFreedom');
  });

  it('после свободы: хватает монет — можно начать, нет — причина с суммой', () => {
    const world = freeWorld({ cash: 400 });
    expect(dreamView(world, 'p1')).toMatchObject({ canStart: true });
    expect(dreamView(world, 'p1')!.reason).toBeUndefined();
    player(world).cash = 390;
    expect(dreamView(world, 'p1')).toMatchObject({ canStart: false, missingCash: 10 });
  });

  it('строится: недели считаются по остатку дней и по тому, работает ли игрок', () => {
    let world = ok(freeWorld(), actionOf('buildDream'));
    expect(dreamView(world, 'p1')).toMatchObject({
      canStart: false, reason: 'building', stageIndex: 0, workPerWeek: 1, weeksLeft: 4,
    });
    world = endWeek(world);
    expect(dreamView(world, 'p1')!.weeksLeft).toBe(3);

    world = ok(world, actionOf('quitJob'));
    // осталось 3 дня при 3 днях в неделю
    expect(dreamView(world, 'p1')).toMatchObject({ workPerWeek: 3, weeksLeft: 1 });

    // не начатый второй этап (5 дней): 5 / 3 → 2 недели, на работе — 5
    const next = freeWorld();
    Object.assign(player(next).dream!, { built: 1 });
    expect(dreamView(next, 'p1')).toMatchObject({ stageIndex: 1, weeksLeft: 5 });
    expect(dreamView(ok(next, actionOf('quitJob')), 'p1')).toMatchObject({ stageIndex: 1, weeksLeft: 2 });
  });

  it('готовая мечта: этапа нет, ждать нечего', () => {
    const world = freeWorld();
    Object.assign(player(world).dream!, { built: 3, building: false, doneWeek: 9 });
    const view = dreamView(world, 'p1')!;
    expect(view).toMatchObject({ stage: null, stageIndex: 3, weeksLeft: 0, canStart: false, reason: 'done' });
  });

  it('свобода, когда мечта будет готова: доход тот же, расходы + содержание', () => {
    const world = freeWorld({ income: 150 });
    const view = dreamView(world, 'p1')!;
    expect(financeView(world, 'p1').freedomRatio).toBeCloseTo(1, 9);
    expect(view.freedomAfterDone).toBeCloseTo(150 / 170, 9);
    // уже готовая — то же значение, что на шкале
    Object.assign(player(world).dream!, { built: 3, doneWeek: 2 });
    expect(dreamView(world, 'p1')!.freedomAfterDone).toBeCloseTo(financeView(world, 'p1').freedomRatio, 9);
  });

  it('не меняет мир', () => {
    const world = freeWorld();
    const snapshot = JSON.stringify(world);
    deepFreeze(world);
    expect(() => dreamView(world, 'p1')).not.toThrow();
    expect(() => financeView(world, 'p1')).not.toThrow();
    expect(JSON.stringify(world)).toBe(snapshot);
  });
});

// ───────────── Миграция сохранений ─────────────

/** Сохранение первой версии: так мир выглядел до второго акта. */
function v1Save(): Record<string, unknown> {
  let world = newWorld(21);
  for (let i = 0; i < 5; i++) world = endWeek(world);
  const raw = JSON.parse(JSON.stringify(world)) as Record<string, unknown>;
  raw.version = 1;
  for (const p of raw.players as Record<string, unknown>[]) {
    delete p.employed;
    delete p.threatWeeks;
    delete p.bestLevel;
    delete p.dream;
    for (const a of p.owned as Record<string, unknown>[]) delete a.level; // улучшений тогда не было
  }
  return raw;
}

describe('миграция сохранений', () => {
  it('версия 1 → 2 → 3 → 4: поля второго акта заполняются, человек получает мечту', () => {
    const raw = v1Save();
    const players = raw.players as Record<string, unknown>[];
    players[0].freedomWeek = 7;
    players[2].freedomWeek = 12; // сосед тоже уже свободен
    const snapshot = JSON.stringify(raw);

    const world = migrateWorld(raw)!;
    expect(world).not.toBeNull();
    expect(world.version).toBe(9);
    expect(JSON.stringify(raw)).toBe(snapshot); // вход не изменился

    const [human, mia, timur] = world.players;
    expect(human).toMatchObject({
      employed: true, threatWeeks: 0, bestLevel: 1,
      dream: { id: 'schooner', built: 0, building: false, progress: 0, doneWeek: null },
    });
    expect(mia).toMatchObject({ employed: true, threatWeeks: 0, bestLevel: 0, dream: null });
    expect(timur).toMatchObject({ employed: true, threatWeeks: 0, bestLevel: 1, dream: null });
    expect(world.players.every((p) => p.employed)).toBe(true);
  });

  it('несвободный человек из старого сохранения начинает с нулевого уровня', () => {
    expect(migrateWorld(v1Save())!.players[0].bestLevel).toBe(0);
  });

  it('переехавший мир играбелен и по-прежнему детерминирован', () => {
    const a = migrateWorld(v1Save())!;
    const b = migrateWorld(v1Save())!;
    const next = endWeek(a);
    expect(next.week).toBe(a.week + 1);
    expect(JSON.stringify(endWeek(b))).toBe(JSON.stringify(next));
    expect(badNumbers(next)).toEqual([]);
  });

  it('мир текущей версии проходит как есть (копией)', () => {
    const world = newWorld(5);
    const raw = JSON.parse(JSON.stringify(world)) as unknown;
    const migrated = migrateWorld(raw)!;
    expect(migrated).toEqual(world);
    expect(migrated).not.toBe(raw);
  });

  it('версия 3 переносит старые события и новости как legacy без изменения входа', () => {
    const source = endWeek(newWorld(4));
    const raw = JSON.parse(JSON.stringify(source)) as Record<string, any>;
    raw.version = 3;
    raw.lastReport.worldEvents = [{ id: 'storm', title: 'Шторм', text: 'Старый шторм', tone: 'bad' }];
    raw.lastReport.players.p1.events = [{ id: 'gift', title: 'Подарок', text: 'Старый подарок', tone: 'good', cashDelta: 10 }];
    raw.lastReport.news = [{ playerId: 'bot-mia', text: 'Старая новость' }];
    const snapshot = JSON.stringify(raw);
    const migrated = migrateWorld(raw)!;
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(migrated.version).toBe(9);
    expect(migrated.lastReport!.worldEvents[0]).toMatchObject({ id: 'storm', legacyTitle: 'Шторм', legacyText: 'Старый шторм' });
    expect(migrated.lastReport!.players.p1.events[0]).toMatchObject({ id: 'gift', legacyTitle: 'Подарок', legacyText: 'Старый подарок' });
    expect(migrated.lastReport!.news).toEqual([{ playerId: 'bot-mia', kind: 'legacy', legacyText: 'Старая новость' }]);
  });

  it('мусор и чужие версии отвергаются', () => {
    const good = JSON.parse(JSON.stringify(newWorld(2))) as Record<string, unknown>;
    const broken = (patch: (w: Record<string, unknown>) => void): unknown => {
      const copy = structuredClone(good);
      patch(copy);
      return copy;
    };
    const garbage: unknown[] = [
      null, undefined, 0, 42, 'world', true, [], {}, { version: 2 }, { version: 1, players: [] },
      broken((w) => { w.version = 10; }),
      broken((w) => { w.version = 0; }),
      broken((w) => { delete w.version; }),
      broken((w) => { w.players = 'no'; }),
      broken((w) => { w.players = []; }),
      broken((w) => { w.players = [null]; }),
      broken((w) => { w.market = null; }),
      broken((w) => { w.offers = {}; }),
      broken((w) => { w.week = 'one'; }),
      broken((w) => { delete (w.players as Record<string, unknown>[])[0].employed; }), // без полей второго акта
      broken((w) => { (w.players as Record<string, unknown>[])[0].dream = { id: 'nope' }; }),
      broken((w) => { (w.players as Record<string, unknown>[])[1].cash = null; }),
    ];
    for (const raw of garbage) expect(migrateWorld(raw), JSON.stringify(raw)?.slice(0, 80)).toBeNull();
  });
});

// ───────────── Соседи-боты и общая надёжность ─────────────

describe('второй акт не трогает соседей', () => {
  it('боты остаются на работе без мечты и без новых событий', () => {
    let world = newWorld(8);
    for (let week = 0; week < 150; week++) {
      const bots = runBots(world);
      expect(bots.errors).toEqual([]);
      const own = bots.world === world ? structuredClone(world) : bots.world;
      world = settleWeek(own, bots.news);
      for (const p of world.players.filter((x) => x.isBot)) {
        expect(p).toMatchObject({ employed: true, threatWeeks: 0, dream: null });
        const ids = world.lastReport!.players[p.id].events.map((e) => e.id);
        expect(ids).not.toContain('freedomThreat');
        expect(ids).not.toContain('backToWork');
        expect(ids).not.toContain('dreamStage');
      }
    }
  });
});

describe('случайные действия: инварианты', () => {
  const ACTIONS: Action['type'][] = [
    'buyOffer', 'sellAsset', 'repairAsset', 'takeLoan', 'repayLoan', 'setInsurance', 'setExtraShift',
    'study', 'rest', 'quitJob', 'returnToWork', 'buildDream', 'buildDream', 'quitJob', 'upgradeAsset', 'upgradeAsset', 'resolveChoice',
  ];

  function randomAction(world: WorldState, rng: Rng): Action {
    const me = player(world);
    const type = ACTIONS[rng.int(0, ACTIONS.length - 1)];
    switch (type) {
      case 'buyOffer': return { type, playerId: 'p1', offerUid: world.offers[rng.int(0, world.offers.length - 1)].uid };
      case 'sellAsset': return { type, playerId: 'p1', assetUid: me.owned[0]?.uid ?? 'none' };
      case 'repairAsset': return { type, playerId: 'p1', assetUid: me.owned[0]?.uid ?? 'none' };
      case 'upgradeAsset': {
        const asset = me.owned.length ? me.owned[rng.int(0, me.owned.length - 1)] : undefined;
        return { type, playerId: 'p1', assetUid: asset?.uid ?? 'none' };
      }
      case 'takeLoan': return { type, playerId: 'p1', amount: 100 * rng.int(1, 5) };
      case 'repayLoan': return { type, playerId: 'p1', loanUid: me.loans[0]?.uid ?? 'none', amount: 100 };
      case 'setInsurance': return { type, playerId: 'p1', on: rng.chance(0.5) };
      case 'setExtraShift': return { type, playerId: 'p1', on: rng.chance(0.5) };
      case 'endWeek': return { type };
      case 'resolveChoice': return { type, playerId: 'p1', accept: rng.chance(0.5) };
      case 'buildRoute': return { type, playerId: 'p1', island: 'cedar' };
      case 'buyBusiness': return { type, playerId: 'p1', business: 'coldStore', loan: 0 };
      case 'setManager': return { type, playerId: 'p1', business: 'coldStore', manager: 'hired' };
      case 'repairBusiness': return { type, playerId: 'p1', business: 'coldStore' };
      case 'setArchInsurance': return { type, playerId: 'p1', on: rng.chance(0.5) };
      case 'archSeen': return { type, playerId: 'p1', what: 'intro' };
      default: return { type, playerId: 'p1' };
    }
  }

  it('счётчики, мечта и работа остаются согласованными за 150 недель на многих сидах', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let world = newWorld(seed);
      const rng = new Rng(seed * 7919);
      let bestSeen = 0;
      for (let week = 0; week < 150; week++) {
        if (week === 5) {
          // чтобы свобода наступила и было что проверять
          giveAsset(world, 'p1', 'deposit', { income: 500 });
          giveAsset(world, 'p1', 'cottage', { income: 150 });
        }
        for (let k = 0; k < 3; k++) {
          const result = applyAction(world, randomAction(world, rng));
          world = result.world;
        }
        world = endWeek(world);

        const p = player(world);
        const where = `seed ${seed}, week ${week}`;
        expect(badNumbers(world), where).toEqual([]);
        expect(p.happiness, where).toBeGreaterThanOrEqual(0);
        expect(p.happiness, where).toBeLessThanOrEqual(100);
        expect(p.employed || p.freedomWeek !== null, `${where}: ушёл без свободы`).toBe(true);
        expect(p.employed ? p.threatWeeks === 0 : p.threatWeeks < R.THREAT_WEEKS, where).toBe(true);
        expect(p.employed || !p.extraShift, where).toBe(true);
        expect(p.bestLevel, where).toBeGreaterThanOrEqual(bestSeen);
        expect(p.bestLevel, where).toBeLessThanOrEqual(R.FREEDOM_LEVEL_RATIOS.length);
        bestSeen = p.bestLevel;
        if (p.freedomWeek !== null) expect(p.bestLevel, where).toBeGreaterThanOrEqual(1);

        const d = p.dream!;
        expect(d.built, where).toBeGreaterThanOrEqual(0);
        expect(d.built, where).toBeLessThanOrEqual(3);
        if (d.building) expect(d.progress, where).toBeLessThan(DREAMS.schooner.stages[d.built].work);
        else expect(d.progress, where).toBe(0);
        expect(d.doneWeek !== null, where).toBe(d.built === 3);
        if (d.doneWeek !== null) expect(d.building, where).toBe(false);

        for (const bot of world.players.filter((x) => x.isBot)) {
          expect(bot, where).toMatchObject({ employed: true, dream: null });
        }
      }
    }
  });
});
