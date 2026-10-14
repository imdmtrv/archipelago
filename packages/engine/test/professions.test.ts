import { describe, expect, it } from 'vitest';
import { POLICIES, runBotTurn } from '../src/bots';
import { ASSET_DEFS, PROFESSIONS, PROFESSION_ORDER } from '../src/content';
import { rollPersonalEvent } from '../src/events';
import { migrateWorld } from '../src/migrate';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import * as R from '../src/rules';
import { financeView } from '../src/selectors';
import type { WorldState } from '../src/types';
import { settleWeek } from '../src/week';
import { createWorld } from '../src/world';
import { player, soloWorld } from './helpers';

/** Подбираем состояние ГПСЧ с сокращением, сохраняя настоящий бросок и его вес. */
function forceLayoff(world: WorldState): void {
  player(world).happiness = 100; // выгорание не расходует ГПСЧ
  for (let state = 1; state < 10000; state++) {
    const candidate = { ...player(world), employed: true, layoffWeeks: 0 };
    if (rollPersonalEvent(candidate, new Rng(state))?.id === 'layoff') {
      world.rng = state;
      return;
    }
  }
  throw new Error('Не найден бросок сокращения');
}

describe('профессии', () => {
  it.each(PROFESSION_ORDER)('%s: стартовые деньги, зарплата, расходы, обычный кредит и доска', (profession) => {
    const def = PROFESSIONS[profession];
    for (let seed = 1; seed <= 50; seed++) {
      const world = createWorld({ seed, playerName: 'Аня', islandName: 'Чайка', profession });
      const me = player(world);
      expect(me).toMatchObject({ profession, cash: def.cash, salary: def.salary, living: def.living,
        layoffWeeks: 0, lastLayoffWeek: 0 });
      expect(me.loans).toEqual(def.loan > 0
        ? [{ uid: expect.any(String), principal: def.loan, weeklyRate: R.LOAN_RATE, emergency: false }] : []);
      expect(me.goals!.hadLoan).toBe(def.loan > 0);
      expect(world.offers.some((o) => ASSET_DEFS[o.defId].kind === 'asset'
        && ASSET_DEFS[o.defId].minKnowledge === 0 && o.price <= me.cash)).toBe(true);
    }
  });

  it('учитель по умолчанию; Мия — учитель, Тимур — капитан, Борис — смотритель', () => {
    const world = createWorld({ seed: 42, playerName: 'Аня', islandName: 'Чайка' });
    expect(world.players.map((p) => p.profession)).toEqual(['teacher', 'teacher', 'captain', 'keeper']);
    for (const p of world.players) {
      const def = PROFESSIONS[p.profession];
      expect(p).toMatchObject({ salary: def.salary, living: def.living, cash: def.cash });
    }
  });
});

describe('сокращение', () => {
  it('неделя события оплачена; затем ровно назначенное число недель без зарплаты и выгорания', () => {
    let world = soloWorld();
    player(world).cash = 10000;
    forceLayoff(world);
    world = settleWeek(world, []);
    const report = world.lastReport!.players.p1;
    const event = report.events.find((e) => e.id === 'layoff')!;
    const weeks = Number(event.params!.weeks);
    expect(event).toMatchObject({ tone: 'bad', params: { weeks, profession: 'teacher' } });
    expect(weeks).toBeGreaterThanOrEqual(R.LAYOFF_WEEKS[0]);
    expect(weeks).toBeLessThanOrEqual(R.LAYOFF_WEEKS[1]);
    expect(report.salary).toBe(PROFESSIONS.teacher.salary);
    expect(player(world)).toMatchObject({ layoffWeeks: weeks, lastLayoffWeek: 1, employed: true });
    expect(financeView(world, 'p1').salary).toBe(0);
    expect(applyAction(world, { type: 'setExtraShift', playerId: 'p1', on: true }).error)
      .toEqual({ code: 'shiftUnemployed' });
    expect(applyAction(world, { type: 'setExtraShift', playerId: 'p1', on: false }).error).toBeUndefined();
    for (let remaining = weeks; remaining > 0; remaining--) {
      player(world).happiness = 0;
      player(world).extraShift = true; // даже оставшийся флаг не даёт зарплаты или штрафа подработки
      world = settleWeek(world, []);
      const r = world.lastReport!.players.p1;
      expect(r.salary).toBe(0);
      expect(r.events.some((e) => e.id === 'burnout' || e.id === 'layoff')).toBe(false);
      expect(player(world).layoffWeeks).toBe(remaining - 1);
      expect(r.events.some((e) => e.id === 'layoffOver')).toBe(remaining === 1);
      if (remaining === 1) expect(r.events).toContainEqual({ id: 'layoffOver', tone: 'good', params: {} });
    }
    expect(financeView(world, 'p1').salary).toBe(player(world).salary);
    player(world).happiness = 100;
    world = settleWeek(world, []);
    expect(world.lastReport!.players.p1.salary).toBeGreaterThan(0);
  });

  it('не бывает без работы и во время сокращения', () => {
    const world = soloWorld();
    forceLayoff(world);
    const state = world.rng;
    player(world).employed = false;
    expect(rollPersonalEvent(player(world), new Rng(state))).toBeNull();
    player(world).employed = true;
    player(world).layoffWeeks = 1;
    expect(rollPersonalEvent(player(world), new Rng(state))).toBeNull();
  });

  it('первое возможно сразу; повторное — ровно на границе перерыва', () => {
    const world = soloWorld();
    forceLayoff(world);
    const first = settleWeek(structuredClone(world), []);
    expect(player(first).lastLayoffWeek).toBe(1);
    player(world).lastLayoffWeek = 1;
    world.week = R.LAYOFF_COOLDOWN;
    const before = settleWeek(structuredClone(world), []);
    expect(before.lastReport!.players.p1.events.some((e) => e.id === 'layoff')).toBe(false);
    expect(player(before).layoffWeeks).toBe(0);
    world.week++;
    const boundary = settleWeek(world, []);
    expect(boundary.lastReport!.players.p1.events.some((e) => e.id === 'layoff')).toBe(true);
    expect(player(boundary).lastLayoffWeek).toBe(1 + R.LAYOFF_COOLDOWN);
  });

  it('уход после свободы сбрасывает сокращение', () => {
    const world = soloWorld();
    player(world).freedomWeek = 1;
    player(world).layoffWeeks = 3;
    const result = applyAction(world, { type: 'quitJob', playerId: 'p1' });
    expect(result.error).toBeUndefined();
    expect(player(result.world)).toMatchObject({ employed: false, layoffWeeks: 0 });
  });

  it('боты тоже сокращаются, появляется новость, подработка не вызывает ошибку', () => {
    const world = soloWorld();
    forceLayoff(world);
    player(world).isBot = true;
    player(world).botStyle = 'saver';
    player(world).goals = null;
    const after = settleWeek(world, []);
    expect(after.lastReport!.news).toContainEqual({ playerId: 'p1', kind: 'layoff' });
    const turn = runBotTurn(after, 'p1', POLICIES.saver);
    expect(turn.errors).toEqual([]);
    expect(turn.actions.some((a) => a.type === 'setExtraShift' && a.on)).toBe(false);
  });
});

describe('миграция v6 → v7', () => {
  it('назначает профессии и очищает сокращение, сохраняя финансы и исходный мир', () => {
    const raw = JSON.parse(JSON.stringify(createWorld({ seed: 17, playerName: 'Аня', islandName: 'Чайка', profession: 'doctor' })));
    raw.version = 6;
    for (const p of raw.players) {
      delete p.profession;
      delete p.layoffWeeks;
      delete p.lastLayoffWeek;
      p.salary += 15;
      p.living += 20;
    }
    const before = structuredClone(raw);
    const migrated = migrateWorld(raw)!;
    expect(migrated.version).toBe(7);
    expect(migrated.players.map((p) => p.profession)).toEqual(['teacher', 'teacher', 'teacher', 'teacher']);
    for (const [i, p] of migrated.players.entries()) {
      expect(p).toMatchObject({ salary: raw.players[i].salary, living: raw.players[i].living,
        cash: raw.players[i].cash, loans: raw.players[i].loans, layoffWeeks: 0, lastLayoffWeek: 0 });
    }
    expect(raw).toEqual(before);
    expect(migrateWorld(migrated)).toEqual(migrated);
    expect(applyAction(migrated, { type: 'endWeek' }).error).toBeUndefined();
  });

  it('v7 сохраняет профессию и сокращение, отклоняет неверные поля', () => {
    const world = createWorld({ seed: 17, playerName: 'Аня', islandName: 'Чайка', profession: 'doctor' });
    player(world).layoffWeeks = 2;
    player(world).lastLayoffWeek = 1;
    expect(migrateWorld(world)).toEqual(world);
    for (const patch of [{ profession: 'unknown' }, { profession: 'toString' }, { layoffWeeks: -1 },
      { layoffWeeks: 1.5 }, { lastLayoffWeek: -1 }, { lastLayoffWeek: NaN }]) {
      const bad = structuredClone(world);
      Object.assign(player(bad), patch);
      expect(migrateWorld(bad)).toBeNull();
    }
  });
});
