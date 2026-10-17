import { simulateArchipelago } from './archipelago';
// Балансовый симулятор: много сидов × много недель, статистика по стилям игры.
// Первый акт (путь к свободе), «Второй акт» (остаться на работе, уйти сразу, уйти при 150%),
// «Улучшения» (разумный игрок с ними и без них) и четыре профессии на одинаковых сидах.
// Цели печатаются как OK/FAIL; при любом FAIL код выхода 1.
// Запуск: npm run sim -w @arch/engine [-- --seeds 500 --weeks 100]
import { runBotTurn, type Policy } from '../src/bots';
import { PROFESSION_ORDER } from '../src/content';
import { realPassiveIncome } from '../src/economy';
import { applyAction } from '../src/reducer';
import { financeView } from '../src/selectors';
import type { ProfessionId, WorldState } from '../src/types';
import { createWorld, HUMAN_ID } from '../src/world';
import * as R from '../src/rules';
import { ACT_LABELS, ENGAGEMENT_LABELS, HUMAN_POLICIES, SECOND_ACT_POLICIES } from './policies';
import { checkProfessionComparison } from './profession-balance';

// ───────────── Прогон ─────────────

interface Outcome {
  freedomWeek: number | null;
  debt: number;
  burnouts: number;
  layoffs: number;
  emergencyWeeks: number;
  netWorth: number;
  scamsLost: number;
  // Второй акт.
  dreamWeek: number | null;   // неделя, когда мечта готова
  forcedReturns: number;      // сколько раз пришлось вернуться на работу (событие backToWork)
  quitAfterFreedom: boolean;  // хоть раз был без работы после свободы
  joySum: number;             // сумма счастья по неделям после свободы
  joyWeeks: number;           // сколько было таких недель
  // Улучшения.
  bestLevel: number;          // высший уровень свободы за игру (0..3)
  passive: number;            // настоящий пассивный доход в неделю к концу игры
  upgrades: number;           // сколько раз человек улучшал своё
  lent: number;               // выданные соседям монеты
  returned: number;           // возвращённые монеты без благодарности
  goals100: number;           // выполнено целей к 100-й неделе
  rumors: Record<'reliable' | 'gossip', { total: number; real: number }>;
}

function hasNaN(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNaN);
  if (value && typeof value === 'object') return Object.values(value).some(hasNaN);
  return false;
}

function runGame(seed: number, weeks: number, humanPolicy: Policy, profession: ProfessionId = 'teacher'): Map<string, Outcome> {
  let world: WorldState = createWorld({ seed, playerName: 'Игрок', islandName: 'Тест', profession });
  const stats = new Map<string, Outcome>(world.players.map((p) => [p.id, {
    freedomWeek: null, debt: 0, burnouts: 0, layoffs: 0, emergencyWeeks: 0, netWorth: 0, scamsLost: 0,
    dreamWeek: null, forcedReturns: 0, quitAfterFreedom: false, joySum: 0, joyWeeks: 0,
    bestLevel: 0, passive: 0, upgrades: 0, lent: 0, returned: 0, goals100: 0,
    rumors: { reliable: { total: 0, real: 0 }, gossip: { total: 0, real: 0 } },
  }]));
  for (let w = 0; w < weeks; w++) {
    const turn = runBotTurn(world, HUMAN_ID, humanPolicy);
    if (turn.errors.length) throw new Error(`seed ${seed}: ${turn.errors.join('; ')}`);
    stats.get(HUMAN_ID)!.upgrades += turn.actions.filter((a) => a.type === 'upgradeAsset').length;
    stats.get(HUMAN_ID)!.lent += turn.world.players[0].lent
      .filter((l) => !world.players[0].lent.some((old) => old.uid === l.uid)).reduce((sum, l) => sum + l.amount, 0);
    const due = turn.world.upcoming.find((e) => e.week === turn.world.week);
    if (due) {
      const counts = stats.get(HUMAN_ID)!.rumors[due.source];
      counts.total++;
      counts.real += Number(due.real);
    }
    const result = applyAction(turn.world, { type: 'endWeek' });
    if (result.error) throw new Error(result.error.code);
    world = result.world;
    for (const [id, report] of Object.entries(world.lastReport!.players)) {
      const s = stats.get(id)!;
      if (report.events.some((e) => e.id === 'burnout')) s.burnouts++;
      if (report.events.some((e) => e.id === 'layoff')) s.layoffs++;
      if (report.events.some((e) => e.id === 'emergencyLoan')) s.emergencyWeeks++;
      s.scamsLost += report.lostAssetUids.length;
      if (report.events.some((e) => e.id === 'backToWork')) s.forcedReturns++;
      s.returned += report.events.filter((e) => e.id === 'neighborLoanReturned')
        .reduce((sum, e) => sum + Math.round(Number(e.params?.amount) / (1 + R.NEIGHBOR_LOAN_BONUS)), 0);
    }
    if (world.lastReport!.week <= 100) stats.get(HUMAN_ID)!.goals100 = world.players[0].goals?.done.length ?? 0;
    // Счастье «после свободы»: недели, следующие за той, в которую свобода достигнута.
    for (const p of world.players) {
      if (p.freedomWeek === null || world.lastReport!.week <= p.freedomWeek) continue;
      const s = stats.get(p.id)!;
      s.joySum += p.happiness;
      s.joyWeeks++;
      if (!p.employed) s.quitAfterFreedom = true;
    }
  }
  if (hasNaN(world)) throw new Error(`NaN in world, seed ${seed}`);
  for (const p of world.players) {
    const s = stats.get(p.id)!;
    s.freedomWeek = p.freedomWeek;
    s.dreamWeek = p.dream?.doneWeek ?? null;
    const f = financeView(world, p.id);
    s.debt = f.debt;
    s.netWorth = f.netWorth;
    s.bestLevel = p.bestLevel;
    s.passive = realPassiveIncome(p, world.market, world);
  }
  return stats;
}

function percentile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

interface Summary {
  median: number;
  p25: number;
  p75: number;
  freePct: number;
  debtPct: number;
  burnouts: number;
  scams: number;
  netWorth: number;
}

function summarize(outcomes: Outcome[]): Summary {
  // Не достигшие свободы считаются «бесконечностью»: медиана честно показывает «>100».
  const times = outcomes.map((o) => o.freedomWeek ?? Infinity).sort((a, b) => a - b);
  const share = (f: (o: Outcome) => boolean) => Math.round((100 * outcomes.filter(f).length) / outcomes.length);
  const avg = (f: (o: Outcome) => number) => outcomes.reduce((s, o) => s + f(o), 0) / outcomes.length;
  return {
    median: percentile(times, 0.5),
    p25: percentile(times, 0.25),
    p75: percentile(times, 0.75),
    freePct: share((o) => o.freedomWeek !== null),
    debtPct: share((o) => o.debt > 0),
    burnouts: Math.round(avg((o) => o.burnouts)),
    scams: Math.round(avg((o) => o.scamsLost) * 10) / 10,
    netWorth: Math.round(avg((o) => o.netWorth)),
  };
}

function formatRow(label: string, s: Summary, weeks: number): string {
  const w = (n: number) => (Number.isFinite(n) ? String(n) : `>${weeks}`);
  return [
    label.padEnd(20),
    w(s.median).padStart(6), w(s.p25).padStart(6), w(s.p75).padStart(6),
    `${s.freePct}%`.padStart(6), `${s.debtPct}%`.padStart(6),
    String(s.burnouts).padStart(8), String(s.scams).padStart(6), String(s.netWorth).padStart(9),
  ].join(' ');
}

// ───────────── Второй акт: сводка и таблица ─────────────

interface ActSummary {
  freedomMedian: number;  // неделя свободы (медиана)
  dreamMedian: number;    // неделя готовности мечты (медиана; нет мечты = бесконечность)
  gapMedian: number;      // недель от свободы до мечты (медиана среди достигших свободы)
  dreamPct: number;       // % игр, где мечта готова к последней неделе
  forcedAvg: number;      // вынужденных возвратов на игру
  forcedPct: number;      // % игр хотя бы с одним возвратом
  quitPct: number;        // % игр, где игрок хоть раз ушёл с работы (и значит, стратегия вообще сработала)
  happiness: number;      // среднее счастье по неделям после свободы
  netWorth: number;       // средний капитал в конце
}

function summarizeSecondAct(outcomes: Outcome[]): ActSummary {
  const pct = (n: number) => (100 * n) / outcomes.length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
  const free = outcomes.filter((o) => o.freedomWeek !== null);
  const gaps = free.map((o) => (o.dreamWeek === null ? Infinity : o.dreamWeek - o.freedomWeek!));
  return {
    freedomMedian: percentile(sorted(outcomes.map((o) => o.freedomWeek ?? Infinity)), 0.5),
    dreamMedian: percentile(sorted(outcomes.map((o) => o.dreamWeek ?? Infinity)), 0.5),
    gapMedian: gaps.length ? percentile(sorted(gaps), 0.5) : Infinity,
    dreamPct: pct(outcomes.filter((o) => o.dreamWeek !== null).length),
    forcedAvg: avg(outcomes.map((o) => o.forcedReturns)),
    forcedPct: pct(outcomes.filter((o) => o.forcedReturns > 0).length),
    quitPct: pct(outcomes.filter((o) => o.quitAfterFreedom).length),
    happiness: avg(outcomes.filter((o) => o.joyWeeks > 0).map((o) => o.joySum / o.joyWeeks)),
    netWorth: avg(outcomes.map((o) => o.netWorth)),
  };
}

function formatActRow(label: string, s: ActSummary, weeks: number): string {
  const w = (n: number) => (Number.isFinite(n) ? String(n) : `>${weeks}`);
  return [
    label.padEnd(20),
    w(s.freedomMedian).padStart(7), w(s.dreamMedian).padStart(7), w(s.gapMedian).padStart(9),
    `${Math.round(s.dreamPct)}%`.padStart(7), `${Math.round(s.quitPct)}%`.padStart(6),
    s.forcedAvg.toFixed(2).padStart(8), `${Math.round(s.forcedPct)}%`.padStart(6),
    s.happiness.toFixed(1).padStart(8), String(Math.round(s.netWorth)).padStart(9),
  ].join(' ');
}

/** Цели второго акта (docs/ROADMAP.md, «Этап 1»): ни одна стратегия не выигрывает по всем осям. */
function checkSecondActTargets(
  sum: Map<string, ActSummary>, outcomes: Map<string, Outcome[]>, sensibleFreedom: (number | null)[], weeks: number,
): [string, boolean][] {
  const stay = sum.get(ACT_LABELS.stay)!;
  const quitNow = sum.get(ACT_LABELS.quitNow)!;
  const quit150 = sum.get(ACT_LABELS.quit150)!;
  const all = [stay, quitNow, quit150];

  // Четыре оси: время до мечты, капитал, счастье, надёжность свободы. Лучший по всем сразу — это провал баланса.
  const axes: { value: (s: ActSummary) => number; best: 'min' | 'max' }[] = [
    { value: (s) => s.gapMedian, best: 'min' },
    { value: (s) => s.netWorth, best: 'max' },
    { value: (s) => s.happiness, best: 'max' },
    { value: (s) => s.forcedPct, best: 'min' },
  ];
  const isBest = (s: ActSummary, axis: (typeof axes)[number]) => {
    const values = all.map(axis.value);
    return axis.value(s) === (axis.best === 'min' ? Math.min(...values) : Math.max(...values));
  };
  const dominator = all.find((s) => axes.every((axis) => isBest(s, axis)));

  // До свободы все три играют как «разумный» — недели свободы должны совпадать по каждому сиду.
  const sameFreedom = Object.values(ACT_LABELS).every((label) =>
    outcomes.get(label)!.every((o, i) => o.freedomWeek === sensibleFreedom[i]));

  return [
    [`Остался: мечта готова к ${weeks}-й неделе в ≥ 90% игр`, stay.dreamPct >= 90],
    ['Остался: от свободы до мечты 12–30 недель (медиана)', stay.gapMedian >= 12 && stay.gapMedian <= 30],
    // Без этой проверки две цели про «ушёл при 150%» легко выполнить впустую: если до 150% никто не добирается,
    // стратегия — просто копия «остался». Порог 25% подобран по факту: сейчас до 150% доходит треть игр.
    ['Ушёл при 150%: уходит с работы хотя бы в 25% игр (иначе стратегия — копия «остался»)', quit150.quitPct >= 25],
    ['Ушёл при 150%: вынужденный возврат не чаще чем в 10% игр', quit150.forcedPct <= 10],
    ['Ушёл при 150%: счастья после свободы больше, чем у «остался»', quit150.happiness > stay.happiness],
    ['Ушёл сразу: вынужденный возврат в 15–70% игр', quitNow.forcedPct >= 15 && quitNow.forcedPct <= 70],
    ['Остался богаче обоих уходивших (капитал)', stay.netWorth > quitNow.netWorth && stay.netWorth > quit150.netWorth],
    ['Ушёл при 150%: мечта не позже чем на 15 недель после «остался» (медиана)', quit150.gapMedian - stay.gapMedian <= 15],
    ['Ни одна стратегия не лучшая по всем осям (мечта, капитал, счастье, надёжность)', dominator === undefined],
    ['До свободы второй акт не влияет: недели свободы совпадают с «разумным» по каждому сиду', sameFreedom],
  ];
}

// ───────────── Улучшения: сводка и таблица ─────────────

interface UpgradeSummary {
  level2Pct: number;      // % игр, где достигнута «Уверенность» (150%)
  level3Pct: number;      // % игр, где достигнуто «Богатство» (200%)
  passiveMedian: number;  // медиана настоящего пассивного дохода к концу
  netWorth: number;       // средний капитал в конце
  upgradesAvg: number;    // улучшений за игру
  freedomMedian: number;  // неделя первой свободы (медиана)
}

function summarizeUpgrades(outcomes: Outcome[]): UpgradeSummary {
  const pct = (f: (o: Outcome) => boolean) => (100 * outcomes.filter(f).length) / outcomes.length;
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
  return {
    level2Pct: pct((o) => o.bestLevel >= 2),
    level3Pct: pct((o) => o.bestLevel >= 3),
    passiveMedian: percentile(sorted(outcomes.map((o) => o.passive)), 0.5),
    netWorth: outcomes.reduce((s, o) => s + o.netWorth, 0) / outcomes.length,
    upgradesAvg: outcomes.reduce((s, o) => s + o.upgrades, 0) / outcomes.length,
    freedomMedian: percentile(sorted(outcomes.map((o) => o.freedomWeek ?? Infinity)), 0.5),
  };
}

function formatUpgradeRow(label: string, s: UpgradeSummary, weeks: number): string {
  const w = (n: number) => (Number.isFinite(n) ? String(n) : `>${weeks}`);
  return [
    label.padEnd(20),
    w(s.freedomMedian).padStart(7),
    `${Math.round(s.level2Pct)}%`.padStart(6), `${Math.round(s.level3Pct)}%`.padStart(6),
    String(Math.round(s.passiveMedian)).padStart(6), s.upgradesAvg.toFixed(1).padStart(9),
    String(Math.round(s.netWorth)).padStart(9),
  ].join(' ');
}

/** Цели улучшений (docs/ROADMAP.md, «Этап 5»): рост после того, как остров заполнен, а не быстрая первая свобода. */
function checkUpgradeTargets(withUp: UpgradeSummary, without: UpgradeSummary, weeks: number): [string, boolean][] {
  const passiveGain = without.passiveMedian > 0 ? withUp.passiveMedian / without.passiveMedian - 1 : 0;
  return [
    [`Разумный: «Уверенность» (150%) за ${weeks} недель — в ≥ 50% игр`, withUp.level2Pct >= 50],
    [`Разумный: «Богатство» (200%) за ${weeks} недель — в 15–50% игр`, withUp.level3Pct >= 15 && withUp.level3Pct <= 50],
    [`Разумный: пассивный доход к ${weeks}-й неделе (медиана) хотя бы на 20% выше, чем без улучшений`, passiveGain >= 0.2],
    ['Улучшения не ускоряют первую свободу больше чем на 3 недели (медиана)', withUp.freedomMedian >= without.freedomMedian - 3],
  ];
}

/** Цели из MVP_SPEC: «Баланс (цели симулятора)» + санитарные проверки. */
function checkTargets(sum: Map<string, Summary>): [string, boolean][] {
  const get = (label: string) => sum.get(label)!;
  const saver = get(LABELS.saver);
  const sensible = get(LABELS.sensible);
  const spender = get(LABELS.spender);
  const gambler = get(LABELS.gambler);
  return [
    ['Бережливая: медиана 30–40', saver.median >= 30 && saver.median <= 40],
    ['Разумный игрок: медиана 35–50', sensible.median >= 35 && sensible.median <= 50],
    ['Транжира: медиана > 70 (или никогда)', spender.median > 70],
    ['Рисковый: большой разброс (p75 − p25 ≥ 20, бывает и быстрее всех, и в долгах)',
      gambler.p75 - gambler.p25 >= 20 && gambler.p25 < saver.p25 && gambler.debtPct > 0],
    ['Бездельник никогда не свободен', get(LABELS.idle).freePct === 0],
    ['Трудоголик без отдыха выгорает и отстаёт от разумного',
      get(LABELS.grinder).burnouts > 0 && get(LABELS.grinder).median > sensible.median],
  ];
}

const LABELS = {
  sensible: 'human:sensible',
  noUpgrades: 'human:no-upgrades',
  idle: 'human:idle',
  grinder: 'human:grinder',
  saver: 'bot:saver (Мия)',
  spender: 'bot:spender (Тимур)',
  gambler: 'bot:gambler (Борис)',
};

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const key = `npm_config_${name.replaceAll('-', '_')}`;
  const configured = process.env[key] ?? process.env[`npm_config_${name}`];
  const flags = ['seeds', 'weeks', 'arch-seeds'].filter((flag) => process.env[`npm_config_${flag.replaceAll('-', '_')}`] !== undefined
    || process.env[`npm_config_${flag}`] !== undefined);
  const positional = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const inherited = configured === 'true' ? positional[flags.indexOf(name)] : configured;
  const value = Number(i >= 0 ? process.argv[i + 1] : inherited ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name}: positive integer required`);
  return value;
}

/** Дополнительные цели первого шага вовлечённости; прежние пороги сохраняются. */
function checkEngagementTargets(sum: Map<string, Summary>, outcomes: Map<string, Outcome[]>): [string, boolean][] {
  const baseline = sum.get(LABELS.sensible)!.median;
  const median = (label: string) => sum.get(`human:${label}`)!.median;
  const returned = (label: string) => {
    const rows = outcomes.get(label)!;
    const lent = rows.reduce((s, o) => s + o.lent, 0);
    return lent > 0 ? rows.reduce((s, o) => s + o.returned, 0) / lent : 0;
  };
  const goalMedian = percentile(outcomes.get(LABELS.sensible)!.map((o) => o.goals100).sort((a, b) => a - b), 0.5);
  console.log('Развилки, слухи и цели (доля возврата — от всех выданных монет)');
  for (const label of [LABELS.sensible, ...Object.values(ENGAGEMENT_LABELS).map((l) => `human:${l}`)]) {
    console.log(`${label}: свобода ${sum.get(label)!.median}; возврат ${(returned(label) * 100).toFixed(1)}%; цели к 100-й ${percentile(outcomes.get(label)!.map((o) => o.goals100).sort((a, b) => a - b), 0.5)}`);
  }
  for (const source of ['reliable', 'gossip'] as const) {
    const rows = outcomes.get(LABELS.sensible)!;
    const total = rows.reduce((s, o) => s + o.rumors[source].total, 0);
    const real = rows.reduce((s, o) => s + o.rumors[source].real, 0);
    console.log(`Слухи ${source}: сбылось ${real}/${total} (${(100 * real / total).toFixed(1)}%)`);
  }
  console.log('');
  return [
    ['Распродажи: разумный не позже отказавшегося и раньше не больше чем на 4 недели',
      baseline <= median(ENGAGEMENT_LABELS.noFireSales) && baseline >= median(ENGAGEMENT_LABELS.noFireSales) - 4],
    ['Одалживает всем: свобода позже разумного не больше чем на 6 недель', median(ENGAGEMENT_LABELS.lend) >= baseline && median(ENGAGEMENT_LABELS.lend) <= baseline + 6],
    ['Разумный получает большую долю возврата, чем одалживающий всем', returned(LABELS.sensible) > returned(`human:${ENGAGEMENT_LABELS.lend}`)],
    // Медианы целые: неделя разницы — шум, а не вред от слухов
    ['Слушает слухи: свобода не позже разумного больше чем на неделю и раньше не больше чем на 3 недели', median(ENGAGEMENT_LABELS.rumors) <= baseline + 1 && median(ENGAGEMENT_LABELS.rumors) >= baseline - 3],
    ['Разумный к 100-й неделе: медиана выполненных целей ≥ 6', goalMedian >= 6],
  ];
}

// ───────────── Профессии: одинаковая разумная стратегия, капитал к 100-й неделе ─────────────

function checkProfessionTargets(outcomes: Map<ProfessionId, Outcome[]>): [string, boolean][] {
  const rows = [...outcomes].map(([id, games]) => ({
    id,
    median: percentile(games.map((o) => o.freedomWeek ?? Infinity).sort((a, b) => a - b), 0.5),
    freePct: 100 * games.filter((o) => o.freedomWeek !== null).length / games.length,
    capital: percentile(games.map((o) => o.netWorth).sort((a, b) => a - b), 0.5),
    layoffs: games.reduce((sum, o) => sum + o.layoffs, 0) / games.length,
  }));
  console.log('\nПрофессии — разумный игрок, 100 недель; свобода и капитал — медианы, сокращения — среднее');
  for (const row of rows) console.log(`${row.id}: свобода ${row.median}; достигли ${row.freePct.toFixed(1)}%; капитал ${row.capital}; сокращений ${row.layoffs.toFixed(3)}`);
  const earliest = Math.min(...rows.map((r) => r.median));
  const latest = Math.max(...rows.map((r) => r.median));
  const richest = Math.max(...rows.map((r) => r.capital));
  return [
    ...rows.flatMap((r): [string, boolean][] => [
      [`${r.id}: свобода к 100-й неделе в ≥95% игр`, r.freePct >= 95],
      [`${r.id}: медиана свободы 25–48 недель`, r.median >= 25 && r.median <= 48],
    ]),
    ['Профессии: разброс медиан ≤12 недель', latest - earliest <= 12],
    ['Профессии: самая ранняя свобода и самый большой капитал у разных профессий',
      rows.filter((r) => r.median === earliest).every((r) => r.capital < richest)],
    ...checkProfessionComparison(rows),
  ];
}

function main(): void {
  const seeds = arg('seeds', 500);
  const weeks = arg('weeks', 100);
  const started = Date.now();

  const byLabel = new Map<string, Outcome[]>();
  const add = (label: string, o: Outcome) => {
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(o);
  };
  for (const [name, policy] of Object.entries(HUMAN_POLICIES)) {
    for (let seed = 1; seed <= seeds; seed++) {
      const stats = runGame(seed, weeks, policy);
      add(`human:${name}`, stats.get(HUMAN_ID)!);
      // Ботов меряем в мирах с разумным человеком — это основной сценарий игры.
      if (name === 'sensible') {
        add(LABELS.saver, stats.get('bot-mia')!);
        add(LABELS.spender, stats.get('bot-timur')!);
        add(LABELS.gambler, stats.get('bot-boris')!);
      }
    }
  }
  const summaries = new Map([...byLabel].map(([label, outcomes]) => [label, summarize(outcomes)]));

  // Второй акт: те же сиды, человек играет одну из трёх стратегий.
  const actOutcomes = new Map<string, Outcome[]>();
  for (const [label, policy] of SECOND_ACT_POLICIES) {
    const outcomes: Outcome[] = [];
    for (let seed = 1; seed <= seeds; seed++) outcomes.push(runGame(seed, weeks, policy).get(HUMAN_ID)!);
    actOutcomes.set(label, outcomes);
  }
  const actSummaries = new Map([...actOutcomes].map(([label, outcomes]) => [label, summarizeSecondAct(outcomes)]));

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n«Архипелаг» — баланс: ${seeds} сидов × ${weeks} недель (${secs} c)\n`);
  console.log(['policy'.padEnd(20), 'median', '   p25', '   p75', '  free', '  debt', 'burnouts', ' scams', ' netWorth'].join(' '));
  for (const [label, s] of summaries) console.log(formatRow(label, s, weeks));
  console.log('\nmedian/p25/p75 — недели до свободы (не достигшие = бесконечность); free — % достигших;');
  console.log('debt — % с долгом в конце; burnouts/scams — в среднем за игру; netWorth — средний капитал в конце.\n');

  console.log('Второй акт — три стратегии после свободы (те же сиды)\n');
  console.log(['policy'.padEnd(20), 'свобода', ' мечта', 'свобода→м', 'мечта %', 'ушёл %', 'возвраты', ' ≥1 в.', 'счастье', ' капитал'].join(' '));
  for (const [label, s] of actSummaries) console.log(formatActRow(label, s, weeks));
  console.log('\nсвобода/мечта — медианная неделя (не достигшие = бесконечность); свобода→м — недель от свободы до готовой мечты;');
  console.log(`мечта % — игры, где шхуна готова к ${weeks}-й неделе; возвраты — вынужденных возвратов на работу на игру, ≥1 в. — % игр с возвратом;`);
  console.log('ушёл % — игры, где игрок хоть раз остался без работы после свободы (показывает, как часто стратегия вообще срабатывает);');
  console.log('счастье — среднее по неделям после свободы; капитал — средний чистый капитал в конце (шхуна в него не входит).\n');

  const withUp = summarizeUpgrades(byLabel.get(LABELS.sensible)!);
  const without = summarizeUpgrades(byLabel.get(LABELS.noUpgrades)!);
  console.log('Улучшения — разумный игрок с ними и без них (те же сиды)\n');
  console.log(['policy'.padEnd(20), 'свобода', '  150%', '  200%', ' доход', 'улучшений', ' капитал'].join(' '));
  console.log(formatUpgradeRow('с улучшениями', withUp, weeks));
  console.log(formatUpgradeRow('без улучшений', without, weeks));
  console.log(`\n150%/200% — игры, где за ${weeks} недель достигнуты «Уверенность»/«Богатство»; доход — медиана настоящего`);
  console.log('пассивного дохода в неделю к концу; улучшений — в среднем за игру; капитал — средний чистый капитал в конце.\n');

  const sensibleFreedom = byLabel.get(LABELS.sensible)!.map((o) => o.freedomWeek);
  const professionOutcomes = new Map<ProfessionId, Outcome[]>();
  for (const profession of PROFESSION_ORDER) {
    const outcomes: Outcome[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      outcomes.push(runGame(seed, 100, HUMAN_POLICIES.sensible, profession).get(HUMAN_ID)!);
    }
    professionOutcomes.set(profession, outcomes);
  }
  const checks = [
    ...checkTargets(summaries),
    ...checkSecondActTargets(actSummaries, actOutcomes, sensibleFreedom, weeks),
    ...checkUpgradeTargets(withUp, without, weeks),
    ...checkEngagementTargets(summaries, byLabel),
    ...checkProfessionTargets(professionOutcomes),
  ];
  for (const [name, passed] of checks) console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}`);
  if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
  simulateArchipelago(arg('arch-seeds', 300));
}

main();
