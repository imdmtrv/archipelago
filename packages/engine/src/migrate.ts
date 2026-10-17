import { createArch } from './archipelago/model';
import { realFreedomRatio } from './economy';
import { FREEDOM_LEVEL_RATIOS } from './rules';
import { validArchState, validArchChoice } from './archipelago/validation';
// Миграция сохранений: старые версии последовательно приводятся к текущей v9.
// Вход — «сырой» JSON из localStorage, поэтому всё проверяем руками; непонятное — null.
import { DREAMS, GOALS, PROFESSIONS } from './content';
import { newGoalsState } from './goals';
import type { WorldState } from './types';
import { newDreamState } from './world';

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Минимум, без которого движок не сможет играть мир (поля, общие для версий 1 и 2). */
function isPlayerBase(value: unknown): value is Obj {
  return isObj(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.isBot === 'boolean'
    && isNum(value.cash) && isNum(value.salary) && isNum(value.living)
    && isNum(value.happiness) && isNum(value.knowledge)
    && Array.isArray(value.owned) && Array.isArray(value.loans)
    && (value.freedomWeek === null || isNum(value.freedomWeek));
}

function isDreamState(value: unknown): boolean {
  return isObj(value)
    && typeof value.id === 'string' && value.id in DREAMS
    && isNum(value.built) && typeof value.building === 'boolean' && isNum(value.progress)
    && (value.doneWeek === null || isNum(value.doneWeek));
}

/** Игрок версии 2: поля второго акта обязаны быть на месте. */
function isPlayerV2(value: unknown): value is Obj & { owned: unknown[] } {
  return isPlayerBase(value)
    && typeof value.employed === 'boolean'
    && isNum(value.threatWeeks) && isNum(value.bestLevel)
    && (value.dream === null || isDreamState(value.dream));
}

/** Уровень улучшения: целое число от 1. */
function isLevel(value: unknown): boolean {
  return isNum(value) && Number.isInteger(value) && value >= 1;
}

/** Игрок версии 3: у каждого объекта на острове есть уровень улучшения. */
function isPlayerV3(value: unknown): boolean {
  return isPlayerV2(value) && value.owned.every((a) => isObj(a) && isLevel(a.level));
}

function migrateLegacyEvent(value: unknown): unknown {
  if (!isObj(value)) return value;
  const event = { ...value };
  if (typeof event.title === 'string') event.legacyTitle = event.title;
  if (typeof event.text === 'string') event.legacyText = event.text;
  delete event.title;
  delete event.text;
  return event;
}

/** 3 → 4: готовые пользовательские фразы остаются только legacy-полями старого отчёта. */
function v3ToV4(world: Obj): boolean {
  if (world.lastReport !== null) {
    if (!isObj(world.lastReport)) return false;
    const report = world.lastReport;
    if (!Array.isArray(report.worldEvents) || !isObj(report.players) || !Array.isArray(report.news)) return false;
    report.worldEvents = report.worldEvents.map(migrateLegacyEvent);
    for (const playerReport of Object.values(report.players)) {
      if (!isObj(playerReport) || !Array.isArray(playerReport.events)) return false;
      playerReport.events = playerReport.events.map(migrateLegacyEvent);
    }
    report.news = report.news.map((item) => {
      if (!isObj(item) || typeof item.playerId !== 'string') return item;
      if (typeof item.text === 'string') return { playerId: item.playerId, kind: 'legacy', legacyText: item.text };
      return item;
    });
  }
  world.version = 4;
  return true;
}

/** 1 → 2: все остаются на работе, уже достигнутая свобода — первый уровень, мечта только у человека. */
function v1ToV2(players: Obj[]): void {
  players.forEach((p, i) => {
    p.employed = true;
    p.threatWeeks = 0;
    p.bestLevel = p.freedomWeek !== null ? 1 : 0;
    p.dream = i === 0 && p.isBot === false ? newDreamState() : null;
  });
}

/** 2 → 3: всё купленное раньше — первого уровня (улучшений тогда не было). false — непонятный объект. */
function v2ToV3(players: (Obj & { owned: unknown[] })[]): boolean {
  for (const p of players) {
    for (const a of p.owned) {
      if (!isObj(a)) return false;
      if (!isNum(a.level)) a.level = 1;
    }
  }
  return players.every(isPlayerV3);
}

function isWorldBase(raw: unknown): raw is Obj & { players: unknown[] } {
  return isObj(raw)
    && isNum(raw.seed) && isNum(raw.rng) && isNum(raw.nextUid) && isNum(raw.week)
    && isObj(raw.market)
    && isNum(raw.market.fish) && isNum(raw.market.tourism)
    && isNum(raw.market.fishShock) && isNum(raw.market.tourismShock)
    && Array.isArray(raw.offers)
    && (raw.lastReport === null || isObj(raw.lastReport))
    && Array.isArray(raw.players) && raw.players.length > 0;
}

/**
 * Принимает сохранённый мир версии 1–9 и возвращает мир версии 9 (копию, вход не меняется).
 * Версия 1 сначала становится версией 2: игрок-человек (первый, не бот) получает чистую мечту,
 * все остаются на работе, уже достигнутая свобода считается первым уровнем.
 * Версия 2 становится версией 3: всё купленное — первого уровня. Всё непонятное — null.
 */
export function migrateWorld(raw: unknown): WorldState | null {
  if (!isWorldBase(raw)) return null;
  const version = raw.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9) return null;

  let world: Obj;
  try {
    world = structuredClone(raw) as Obj;
  } catch {
    return null;
  }
  const players = world.players as unknown[];

  if (version >= 5) {
    if (!players.every((p) => isPlayerEngagement(p, version)) || !Array.isArray(world.upcoming)
      || !world.upcoming.every((e) => isUpcoming(e) && (version === 5 || isObj(e)
        && typeof e.real === 'boolean' && ['reliable', 'gossip'].includes(String(e.source))))) return null;
    if (version === 5) {
      for (const e of world.upcoming as Obj[]) { e.real = true; e.source = 'reliable'; }
      for (const p of players as Obj[]) {
        if (isObj(p.choice) && p.choice.kind === 'promotion') p.choice = null;
        delete p.promotions;
      }
      world.version = 6;
    }
    if (version >= 7) {
      if (!(players as Obj[]).every((p) => typeof p.profession === 'string'
        && Object.hasOwn(PROFESSIONS, p.profession)
        && isNum(p.layoffWeeks) && Number.isInteger(p.layoffWeeks) && p.layoffWeeks >= 0
        && isNum(p.lastLayoffWeek) && Number.isInteger(p.lastLayoffWeek) && p.lastLayoffWeek >= 0)) return null;
    } else v6ToV7(world);
    if (version < 8) v7ToV8(world);
    else if (!(players as Obj[]).every((p) => isObj(p.noAskUntil)
      && Object.values(p.noAskUntil).every((week) => isNum(week) && Number.isInteger(week) && week >= 0))) return null;
    if (version < 9) v8ToV9(world);
    else if (!validArchState(world.archipelago, (world.players as Obj[]).map((p) => String(p.id)))) return null;
    return world as unknown as WorldState;
  }

  if (version === 1) {
    if (!players.every(isPlayerBase)) return null;
    v1ToV2(players);
  }
  if (version < 3 && (!players.every(isPlayerV2) || !v2ToV3(players))) return null;
  if (!players.every(isPlayerV3) || (version < 4 && !v3ToV4(world))) return null;
  for (const p of players as Obj[]) {
    p.insuranceFrom = p.insured ? world.week : null;
    p.choice = null;
    p.lastChoiceWeek = 0;
    delete p.promotions;
    p.lent = [];
    p.goals = p.isBot ? null : newGoalsState();
  }
  world.upcoming = [];
  v6ToV7(world);
  v7ToV8(world);
  v8ToV9(world);
  return world as unknown as WorldState;
}

/** 7 → 8: ограничений на повторные просьбы в старых сохранениях не было. */
function v7ToV8(world: Obj): void {
  for (const p of world.players as Obj[]) p.noAskUntil = {};
  world.version = 8;
}

/** 8 → 9: открываем архипелаг у уже достигших 150%, в том числе по сохранённому лучшему уровню. */
function v8ToV9(world: Obj): void {
  world.archipelago = null;
  world.version = 9;
  const current = world as unknown as WorldState;
  const me = current.players[0];
  if (me.bestLevel >= 2 || realFreedomRatio(me, current.market, current) >= FREEDOM_LEVEL_RATIOS[1]) current.archipelago = createArch(current.week);
  if (current.lastReport) for (const report of Object.values(current.lastReport.players)) report.arch = null;
}

/** 6 → 7: до профессий у всех были числа учителя — им и остаются; зарплата, расходы и деньги сохраняются. */
function v6ToV7(world: Obj): void {
  for (const p of world.players as Obj[]) {
    p.profession = 'teacher';
    p.layoffWeeks = 0;
    p.lastLayoffWeek = 0;
  }
  world.version = 7;
}

function isPlayerEngagement(value: unknown, version: number): boolean {
  if (!isPlayerV3(value) || !isObj(value)) return false;
  const g = value.goals;
  return (value.insuranceFrom === null || isNum(value.insuranceFrom))
    && isNum(value.lastChoiceWeek) && (version !== 5 || isNum(value.promotions))
    && (value.choice === null || (isObj(value.choice) && typeof value.choice.uid === 'string'
      && (['neighborLoan', version === 5 ? 'promotion' : 'fireSale', 'buyer'].includes(String(value.choice.kind))
        || version >= 9 && validArchChoice(value.choice))
      && isNum(value.choice.week) && isObj(value.choice.params)))
    && Array.isArray(value.lent) && value.lent.every((l) => isObj(l) && typeof l.uid === 'string'
      && typeof l.neighborId === 'string' && isNum(l.amount) && isNum(l.dueWeek) && isNum(l.tries))
    && (value.isBot ? g === null : isObj(g) && Array.isArray(g.active) && Array.isArray(g.done)
      && g.active.every(isGoalId) && g.done.every((d) => isObj(d) && isGoalId(d.id) && isNum(d.week))
      && isNum(g.calmWeeks) && typeof g.hadLoan === 'boolean' && typeof g.insuredStorm === 'boolean');
}

function isGoalId(value: unknown): boolean {
  return typeof value === 'string' && GOALS.some((g) => g.id === value);
}

function isUpcoming(value: unknown): boolean {
  return isObj(value) && ['storm', 'fishShoal', 'touristBoom', 'crisis'].includes(String(value.kind))
    && isNum(value.week) && isNum(value.windowStart) && isNum(value.announcedWeek);
}
