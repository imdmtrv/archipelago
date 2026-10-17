// Семь стратегий на публичных действиях движка; раздел общего балансировочного прогона.
import { pathToFileURL } from 'node:url';
import { runBotTurn } from '../src/bots';
import { realFreedomRatio, realPassiveIncome } from '../src/economy';
import { applyAction } from '../src/reducer';
import { financeView, getPlayer } from '../src/selectors';
import type { WorldState } from '../src/types';
import { createWorld } from '../src/world';
import { activeSets, createArch, humanShare } from '../src/archipelago/model';
import { createStrategy, STRATEGY_NAMES, type StrategyName } from '../src/archipelago/strategies';
import type { ArchState } from '../src/types';

export function badNumbers(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(badNumbers);
  return !!value && typeof value === 'object' && Object.values(value).some(badNumbers);
}

/** Удачу архипелага меряем на равном сроке после открытия: сколько недель досталось архипелагу — удача первого акта. */
export const ARCH_HORIZON = 80;

/** Капитал уже включает доли дел и выданные банком займы. */
export function capitalOf(world: WorldState, _arch?: ArchState): number {
  return financeView(world, 'p1').netWorth;
}

export function runGame(seed: number, weeks: number, name: StrategyName): {
  world: WorldState; arch: ArchState | null; joySum: number; joyWeeks: number;
  /** Капитал через ARCH_HORIZON недель после открытия (null — столько недель не прошло). */
  capitalAtHorizon: number | null;
  setsSeen: { fishing: boolean; resort: boolean }; mainlandBuilt: number;
} {
  let world = createWorld({ seed, playerName: 'Игрок', islandName: 'Тест', profession: 'teacher' });
  const strategy = createStrategy(name);
  let joySum = 0;
  let joyWeeks = 0;
  let capitalAtHorizon: number | null = null;
  // spec: набор учитывается, если был собран хотя бы раз; продажи материку не считаются его стройками.
  const setsSeen = { fishing: false, resort: false };
  let mainlandBuilt = 0;
  const recordSets = () => { if (world.archipelago) for (const set of activeSets(world.archipelago)) setsSeen[set] = true; };
  for (let w = 0; w < weeks; w++) {
    const turn = runBotTurn(world, 'p1', strategy.homePolicy);
    if (turn.errors.length) throw new Error(`seed ${seed}, ${name}, week ${world.week}: ${turn.errors.join('; ')}`);
    world = turn.world;
    // Решения на родном острове — тоже решения игрока (отдых и подработка — нет).
    if (world.archipelago && turn.actions.some((a) => a.type !== 'rest' && a.type !== 'setExtraShift')) world.archipelago.log.homeDecisionWeeks.push(world.week);
    if (world.archipelago) {
      for (let step = 0; step < 20; step++) {
        const action = strategy.decide(world, world.archipelago!);
        if (!action) break;
        const result = applyAction(world, { ...action, playerId: 'p1' });
        if (result.error) throw new Error(`seed ${seed}, ${name}, week ${world.week}: ${action.type}: ${result.error.code}`);
        world = result.world;
        recordSets();
      }
    }
    const result = applyAction(world, { type: 'endWeek' });
    if (result.error) throw new Error(`seed ${seed}, ${name}: ${result.error.code}`);
    world = result.world;
    mainlandBuilt += world.lastReport!.players.p1.events.filter((e) => e.id === 'archMainlandBuilt').length;
    const arch = world.archipelago;
    recordSets();
    if (arch && world.lastReport!.week === arch.openWeek + ARCH_HORIZON) capitalAtHorizon = capitalOf(world, arch);
    if (arch && world.lastReport!.week > arch.openWeek) {
      joySum += getPlayer(world, 'p1').happiness;
      joyWeeks++;
    }
  }
  if (badNumbers(world) || badNumbers(world.archipelago)) throw new Error(`Нечисловое состояние: seed ${seed}, ${name}`);
  return { world, arch: world.archipelago, joySum, joyWeeks, capitalAtHorizon, setsSeen, mainlandBuilt };
}

interface Outcome {
  open: number | null; finale: number | null; capital: number; capitalH: number | null; passive: number; freedom: number;
  joySum: number; joyWeeks: number; legacy: number; timurFree: boolean; gap: number; maxGap: number;
  businesses: number; routes: number; lent: number; lost: number; interest: number;
  miaSolo: number; miaPartner: number; borisSolo: number; borisPartner: number;
  fishing: boolean; resort: boolean; mainlandBuilt: number;
}

function outcome(game: ReturnType<typeof runGame>, weeks: number): Outcome {
  const { world, joySum, joyWeeks } = game;
  const arch = game.arch ?? createArch(weeks);
  const me = getPlayer(world, 'p1');
  const end = arch.finaleWeek ?? weeks;
  // spec: промежутки включают края окна; несколько действий одной недели — одно решение.
  const decisions = [...new Set([...arch.log.decisionWeeks, ...arch.log.homeDecisionWeeks])].sort((a, b) => a - b).filter((w) => w > (arch.openWeek ?? weeks) && w <= end);
  const bounds = [arch.openWeek ?? weeks, ...decisions, end];
  const gaps = bounds.slice(1).map((w, i) => w - bounds[i]);
  const builds = (id: string, partner: boolean) => arch.businesses.filter((b) => b.stakes.some((s) => s.playerId === id)
    && (humanShare(b) > 0) === partner).length;
  return {
    open: game.arch?.openWeek ?? null, finale: arch.finaleWeek,
    capital: capitalOf(world, arch), capitalH: game.capitalAtHorizon,
    passive: realPassiveIncome(me, world.market, world), freedom: realFreedomRatio(me, world.market, world),
    joySum, joyWeeks, legacy: arch.log.paidToNeighbors, timurFree: realFreedomRatio(getPlayer(world, 'bot-timur'), world.market, world) >= 1,
    gap: gaps.reduce((sum, g) => sum + g, 0) / gaps.length, maxGap: Math.max(...gaps),
    businesses: arch.businesses.filter((b) => humanShare(b) > 0).length, routes: arch.routes.length,
    lent: arch.log.bankLent, lost: arch.log.bankDefaulted, interest: arch.log.bankInterest,
    miaSolo: builds('bot-mia', false), miaPartner: builds('bot-mia', true),
    borisSolo: builds('bot-boris', false), borisPartner: builds('bot-boris', true),
    fishing: game.setsSeen.fishing, resort: game.setsSeen.resort, mainlandBuilt: game.mainlandBuilt,
  };
}

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  // Тот же выбор ранга, что и у существующего simulate.ts.
  return sorted.length ? sorted[Math.round((sorted.length - 1) * q)] : Infinity;
}

function summarize(games: Outcome[], weeks: number) {
  const median = (get: (o: Outcome) => number) => percentile(games.map(get), 0.5);
  const total = (get: (o: Outcome) => number) => games.reduce((sum, o) => sum + get(o), 0);
  const capital = games.map((o) => o.capital);
  // spec: длительность до финала считаем среди завершивших; незавершивших отражает процент финалов.
  const finished = games.filter((o) => o.finale !== null && o.finale <= weeks);
  return {
    open: median((o) => o.open ?? Infinity), fin: 100 * finished.length / games.length,
    duration: percentile(finished.map((o) => o.finale! - o.open!), 0.5),
    capital: percentile(capital, 0.5), p10: percentile(capital, 0.1), p25: percentile(capital, 0.25), p75: percentile(capital, 0.75),
    passive: median((o) => o.passive), freedom: median((o) => 100 * o.freedom),
    joy: total((o) => o.joySum) / Math.max(1, total((o) => o.joyWeeks)), legacy: median((o) => o.legacy),
    timur: 100 * total((o) => Number(o.timurFree)) / games.length,
    gap: median((o) => o.gap), maxGap: median((o) => o.maxGap), businesses: median((o) => o.businesses), routes: median((o) => o.routes),
    lent: median((o) => o.lent), lost: median((o) => o.lost), interest: median((o) => o.interest),
    miaSolo: total((o) => o.miaSolo), miaPartner: total((o) => o.miaPartner),
    borisSolo: total((o) => o.borisSolo), borisPartner: total((o) => o.borisPartner),
    fishing: 100 * total((o) => Number(o.fishing)) / games.length,
    resort: 100 * total((o) => Number(o.resort)) / games.length, mainlandBuilt: median((o) => o.mainlandBuilt),
  };
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  // Вложенный npm run превращает --seeds N --weeks M в позиционные N M.
  const forwarded = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const configured = process.env[`npm_config_${name}`];
  const position = name === 'seeds' ? 0 : process.env.npm_config_seeds ? 1 : 0;
  const inherited = configured && configured !== 'true' ? configured : configured ? forwarded[position] : undefined;
  const npmFlags = process.env.npm_config_seeds !== undefined || process.env.npm_config_weeks !== undefined;
  const positional = !npmFlags && process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[name === 'seeds' ? 2 : 3] : undefined;
  const value = Number(index === -1 ? inherited ?? positional ?? fallback : process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name}: требуется положительное целое`);
  return value;
}

export function simulateArchipelago(seeds = 300, weeks = 160): void {
  const started = Date.now();
  const results = new Map<StrategyName, Outcome[]>();
  const errors: string[] = [];
  for (const name of STRATEGY_NAMES) {
    const games: Outcome[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      try { games.push(outcome(runGame(seed, weeks, name), weeks)); }
      catch (error) { errors.push(String(error)); }
    }
    results.set(name, games);
  }
  const summaries = new Map([...results].map(([name, games]) => [name, summarize(games, weeks)]));
  const home = summaries.get('Домосед')!;
  const random = summaries.get('Наобум')!;
  const active = STRATEGY_NAMES.slice(1, 5).map((name) => ({ name, ...summaries.get(name)! }));
  // Удача архипелага — разброс прибавки к капиталу против домоседа на том же сиде: удача первого акта
  // (когда пришла свобода, что выпало на родном острове) одинакова у всех стратегий и сюда не входит.
  const gain = (name: StrategyName) => results.get(name)!.flatMap((o, i) => {
    const home = results.get('Домосед')![i]?.capitalH;
    return o.capitalH === null || home == null ? [] : [o.capitalH - home];
  });
  const best = active.find((s) => s.name === STRATEGY_NAMES[1])!;
  const luck = percentile(gain(best.name), 0.75) - percentile(gain(best.name), 0.25);
  const skill = percentile(gain(best.name), 0.5) - percentile(gain('Наобум'), 0.5);
  const ratio = skill > 0 ? luck / skill : Infinity;
  const rawSkill = best.capital - random.capital;
  const rawRatio = rawSkill > 0 ? (best.p75 - best.p25) / rawSkill : Infinity;
  const sensible = STRATEGY_NAMES.slice(0, 6).map((name) => summaries.get(name)!);
  const partner = summaries.get('Партнёр соседей')!;
  const fmt = (n: number, digits = 0) => Number.isFinite(n) ? n.toFixed(digits) : '—';
  console.log(`Архипелаг: ${seeds} сидов × ${weeks} недель; ${((Date.now() - started) / 1000).toFixed(1)} c`);
  console.log('Стратегия|Откр|Фин%/Δ|Капитал/m,p10,p25–p75|Доход/Своб%|Счастье|Соседям/Тимур%|Решения/макс|Дела/линии|Банк:выдано/потери/%|Мия:сам/парт|Борис:сам/парт');
  for (const [name, s] of summaries) console.log([name, fmt(s.open), `${fmt(s.fin, 1)}/${fmt(s.duration)}`,
    `${fmt(s.capital)},${fmt(s.p10)},${fmt(s.p25)}–${fmt(s.p75)}`, `${fmt(s.passive)}/${fmt(s.freedom)}`,
    fmt(s.joy, 1), `${fmt(s.legacy)}/${fmt(s.timur, 1)}`, `${fmt(s.gap, 1)}/${fmt(s.maxGap)}`,
    `${fmt(s.businesses)}/${fmt(s.routes)}`, `${fmt(s.lent)}/${fmt(s.lost)}/${fmt(s.interest)}`,
    `${s.miaSolo}/${s.miaPartner}`, `${s.borisSolo}/${s.borisPartner}`].join('|'));
  for (const [name, s] of summaries) console.log(`Наборы/материк|${name}|рыбная=${fmt(s.fishing, 1)}%|курорт=${fmt(s.resort, 1)}%|строек/m=${fmt(s.mainlandBuilt)}`);
  console.log(`Прибавка к капиталу против домоседа через ${ARCH_HORIZON} недель после открытия (медиана, p25–p75; игр ${gain('Цепочка').length}): ${STRATEGY_NAMES.slice(1).map((name) =>
    `${name} ${fmt(percentile(gain(name), 0.5))} (${fmt(percentile(gain(name), 0.25))}–${fmt(percentile(gain(name), 0.75))})`).join('; ')}`);
  console.log(`Удача/умение (прибавка): ${best.name}; ${fmt(luck)}/${fmt(skill)}=${fmt(ratio, 3)}; по всему капиталу ${fmt(rawRatio, 3)} (Cashflow 101: 2.8)`);
  const resortGain = gain('Курорт');
  const resortLuck = percentile(resortGain, 0.75) - percentile(resortGain, 0.25);
  const resortSkill = percentile(resortGain, 0.5) - percentile(gain('Наобум'), 0.5);
  console.log(`Удача/умение курорта (справочно): ${fmt(resortLuck)}/${fmt(resortSkill)}=${fmt(resortSkill > 0 ? resortLuck / resortSkill : Infinity, 3)}`);
  console.log('Δ — медиана от открытия до финала среди завершивших; Мия/Борис — число строек по всем сидам; остальные счётчики — медианы.');
  const checks: [number, boolean, string][] = [
    [1, active.every((s) => s.capital > home.capital), 'Активные богаче домоседа'],
    [2, !sensible.some((s) => (['capital', 'p10', 'joy', 'legacy'] as const)
      .every((key) => s[key] >= Math.max(...sensible.map((r) => r[key])))), 'Нет единственной лучшей стратегии'],
    [3, ratio < 1, `Удача/умение < 1: ${fmt(ratio, 3)}`],
    [4, active.filter((s) => s.name !== 'Партнёр соседей').every((s) => s.capital > random.capital),
      'Наобум уступает цепочке, курорту и понемногу'],
    [5, ['Везде понемногу', 'Партнёр соседей'].every((name) => {
      const s = summaries.get(name as StrategyName)!;
      return s.fin >= 50 && Number.isFinite(s.duration) && s.duration >= 30;
    }), 'Финал ≥50%, Δ≥30: понемногу и партнёр'],
    [6, active.every((s) => {
      return s.gap <= 4 && s.maxGap <= 12;
    }), 'Решения: средний промежуток ≤4, максимальный ≤12'],
    [7, partner.timur - home.timur >= 15, `Свобода Тимура: прибавка ${fmt(partner.timur - home.timur, 1)} п.п. ≥15`],
    [8, errors.length === 0 && Array.from({ length: seeds }, (_, i) => STRATEGY_NAMES
      .every((name) => results.get(name)![i]?.open === results.get('Домосед')![i]?.open)).every(Boolean), 'Открытие одинаково на каждом сиде'],
    [9, errors.length === 0, `Без NaN и ошибок действий; ошибок=${errors.length}`],
  ];
  for (const [id, passed, message] of checks) console.log(`${passed ? 'OK  ' : 'FAIL'} ${id}. ${message}`);
  if (errors.length) console.log(`Первая ошибка: ${errors[0]}`);
  if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) simulateArchipelago(arg('seeds', 300), arg('weeks', 160));
