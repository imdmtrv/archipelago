// Случайные события: личные (для каждого игрока) и общие (для всего архипелага).
import { getDef, happinessJoy } from './economy';
import { insuranceActive } from './engagement';
import type { Rng } from './rng';
import * as R from './rules';
import type { DreamDef, EventParam, GameEvent, PlayerState, PlayerWeekReport, WorldEventKind, WorldState } from './types';

/** Все id событий — чтобы UI мог подобрать иконки. */
export type EventId =
  | 'illness' | 'breakdown' | 'gift' | 'raise' | 'burnout' | 'layoff' | 'layoffOver'
  | 'storm' | 'stormDamage' | 'stormInsured' | 'fishShoal' | 'touristBoom' | 'crisis'
  | 'scamCollapse' | 'emergencyLoan' | 'freedom'
  | 'rumor' | 'rumorFalse' | 'goalDone' | 'neighborLoanReturned' | 'neighborLoanLate' | 'neighborLoanLost' | 'insuranceStarted'
  | 'dreamStage' | 'dreamDone' | 'freedomLevel' | 'freedomThreat' | 'threatOver' | 'backToWork';

/** Число текстовых вариантов. Порядок и количество синхронны со словарями UI. */
export const EVENT_VARIANTS = { breakdown: 3, gift: 3 } as const;

function event(
  id: EventId, tone: GameEvent['tone'], params: Record<string, EventParam> = {}, extra: Partial<GameEvent> = {},
): GameEvent {
  return { id, tone, params, ...extra };
}

function roundTo5(n: number): number { return Math.round(n / 5) * 5; }
function pickVariant(rng: Rng, count: number): number { return rng.int(0, count - 1); }

// ───────────── Выгорание ─────────────

export function rollBurnout(player: PlayerState, rng: Rng): boolean {
  if (player.happiness >= R.BURNOUT_THRESHOLD) return false;
  const depth = (R.BURNOUT_THRESHOLD - player.happiness) / R.BURNOUT_THRESHOLD; // 0..1
  return rng.chance(R.BURNOUT_CHANCE_MIN + (R.BURNOUT_CHANCE_MAX - R.BURNOUT_CHANCE_MIN) * depth);
}

export function burnoutEvent(): GameEvent { return event('burnout', 'bad'); }

// ───────────── Личные события ─────────────

/** Бросает личное событие; повышение сразу меняет зарплату и расходы игрока. */
export function rollPersonalEvent(player: PlayerState, rng: Rng): GameEvent | null {
  if (!rng.chance(R.PERSONAL_EVENT_CHANCE)) return null;
  const kind = rng.weighted(R.PERSONAL_EVENT_WEIGHTS);
  switch (kind) {
    case 'illness': {
      const cost = roundTo5(rng.range(...R.ILLNESS_COST));
      return player.insured
        ? event('illness', 'neutral', { insured: 1 }, { cashDelta: 0 })
        : event('illness', 'bad', { cost }, { cashDelta: -cost });
    }
    case 'breakdown': {
      const cost = roundTo5(rng.range(...R.BREAKDOWN_COST));
      const variant = pickVariant(rng, EVENT_VARIANTS.breakdown);
      return { ...event('breakdown', 'bad', { cost }, { cashDelta: -cost }), variant };
    }
    case 'gift': {
      const amount = roundTo5(rng.range(...R.GIFT_AMOUNT));
      const variant = pickVariant(rng, EVENT_VARIANTS.gift);
      return { ...event('gift', 'good', { amount }, { cashDelta: amount }), variant };
    }
    case 'raise': {
      if (!player.employed) return null; // повышение бывает только на работе
      player.salary += R.RAISE_SALARY;
      player.living += R.RAISE_LIVING;
      return event('raise', 'good', { salaryIncrease: R.RAISE_SALARY, livingIncrease: R.RAISE_LIVING });
    }
    case 'layoff': {
      if (!player.employed || player.layoffWeeks > 0) return null;
      return event('layoff', 'bad', { weeks: rng.int(...R.LAYOFF_WEEKS), profession: player.profession });
    }
  }
}

/**
 * Изменение счастья за неделю: будни (только пока работаешь) + радость от статусных вещей и мечты
 * + штраф за подработку.
 */
export function weeklyHappinessDelta(player: PlayerState): number {
  // Будни отнимают счастье только на работе: без работы и во время сокращения — нет
  const drift = player.employed && player.layoffWeeks === 0 ? R.HAPPINESS_DRIFT : 0;
  return drift + happinessJoy(player) + (player.extraShift ? R.EXTRA_SHIFT_JOY : 0);
}

// ───────────── Общие события ─────────────

function applyStorm(world: WorldState, rng: Rng, reports: Record<string, PlayerWeekReport>): GameEvent {
  const damagedAll: string[] = [];
  for (const player of world.players) {
    const hit = player.owned.filter((a) => {
      const risk = getDef(a.defId).stormRisk;
      return !a.damaged && risk > 0 && rng.chance(risk);
    });
    if (hit.length === 0) continue;
    const uids = hit.map((a) => a.uid);
    const assetRefs = hit.map((a) => `${a.defId}:${a.level}`);
    if (insuranceActive(player, world.week)) {
      reports[player.id].events.push(event('stormInsured', 'good', { assetRefs }, { affectedAssetUids: uids }));
      continue;
    }
    for (const a of hit) a.damaged = true;
    damagedAll.push(...uids);
    reports[player.id].events.push(event('stormDamage', 'bad', { assetRefs }, { affectedAssetUids: uids }));
  }
  return event('storm', 'bad', {}, { affectedAssetUids: damagedAll });
}

/** Исполняет запланированное событие или опровергает слух; на одну неделю — один слух. */
export function rollWorldEvent(world: WorldState, rng: Rng, reports: Record<string, PlayerWeekReport>): GameEvent[] {
  const due = world.upcoming.find((e) => e.week === world.week);
  world.upcoming = world.upcoming.filter((e) => e.week !== world.week);
  const events = due?.real ? applyWorldEvent(due.kind, world, rng, reports) : [];
  if (due && !due.real) {
    for (const player of world.players) reports[player.id].events.push(event('rumorFalse', 'neutral', { kind: due.kind }));
  }
  const schedule = (real: boolean) => {
    const kind = rng.weighted(R.WORLD_EVENT_WEIGHTS);
    const week = world.week + rng.int(...R.RUMOR_LEAD);
    if (!world.upcoming.some((e) => e.week === week)) {
      const windowStart = week - rng.int(0, 1);
      const source = real ? (rng.chance(R.RUMOR_RELIABLE_SHARE) ? 'reliable' : 'gossip')
        : (rng.chance(R.FALSE_RUMOR_GOSSIP_SHARE) ? 'gossip' : 'reliable');
      world.upcoming.push({ kind, week, windowStart, announcedWeek: world.week, real, source });
      for (const player of world.players) {
        reports[player.id].events.push({ id: 'rumor', tone: 'neutral', params: {
          kind, source, fromWeek: windowStart, toWeek: windowStart + 1,
          ...(player.knowledge >= R.RUMOR_EXACT_KNOWLEDGE ? { exactWeek: week } : {}),
        } });
      }
    }
  };
  if (rng.chance(R.WORLD_EVENT_CHANCE)) schedule(true);
  if (rng.chance(R.FALSE_RUMOR_CHANCE)) schedule(false);
  return events;
}

function applyWorldEvent(kind: WorldEventKind, world: WorldState, rng: Rng, reports: Record<string, PlayerWeekReport>): GameEvent[] {
  if (kind === 'storm') {
    for (const player of world.players) {
      if (player.goals && insuranceActive(player, world.week) && player.owned.some((a) => getDef(a.defId).stormRisk > 0)) {
        player.goals.insuredStorm = true;
      }
    }
  }
  const market = world.market;
  switch (kind) {
    case 'storm': return [applyStorm(world, rng, reports)];
    case 'fishShoal':
      market.fishShock += R.SHOAL_FISH_SHOCK;
      return [event('fishShoal', 'good')];
    case 'touristBoom':
      market.tourismShock += R.BOOM_TOURISM_SHOCK;
      return [event('touristBoom', 'good')];
    case 'crisis':
      market.tourismShock += R.CRISIS_TOURISM_SHOCK;
      market.fishShock += R.CRISIS_FISH_SHOCK;
      return [event('crisis', 'bad')];
  }
}

// ───────────── Аферы, долги, свобода ─────────────

export function scamCollapseEvent(assetUid: string, defId: string): GameEvent {
  return event('scamCollapse', 'bad', { defId }, { affectedAssetUids: [assetUid] });
}
export function emergencyLoanEvent(amount: number): GameEvent {
  return event('emergencyLoan', 'bad', { amount, rate: Math.round(R.EMERGENCY_RATE * 100) });
}
export function freedomEvent(): GameEvent { return event('freedom', 'good'); }
export function dreamStageEvent(dream: DreamDef, finishedStage: number): GameEvent {
  return event('dreamStage', 'good', { dreamId: dream.id, finishedStage, nextStage: finishedStage + 1 < dream.stages.length ? finishedStage + 1 : -1 });
}
export function dreamDoneEvent(dream: DreamDef): GameEvent {
  return event('dreamDone', 'good', { dreamId: dream.id, upkeep: dream.upkeep });
}
// ───────────── Второй акт ─────────────

/** Уровень 1 («Свобода») празднует freedomEvent; здесь — запас прочности: 2 и выше. */
export function freedomLevelEvent(level: number): GameEvent { return event('freedomLevel', 'good', { level }); }
export function freedomThreatEvent(weeksLeft: number): GameEvent { return event('freedomThreat', 'bad', { weeksLeft }); }
export function threatOverEvent(): GameEvent { return event('threatOver', 'good'); }
export function backToWorkEvent(salary: number): GameEvent { return event('backToWork', 'bad', { salary }); }
