import { archProjection, fishBonus, grossIncome, linesNet, managerFee, normalizeManagers } from './archipelago/model';
import { finishArchWeek, settleArchWeek } from './archipelago/week';
import { OWNER_DAY_JOY } from './archipelago/rules';
// Подсчёт итогов недели (шаги 2–8 из endWeek). Работает на уже скопированном мире.
import { addLoan, returnToJob } from './actions';
import { generateChoice, resolvePendingChoice, settleLent } from './choices';
import { insuranceActive } from './engagement';
import { settleGoals } from './goals';
import {
  clamp, currentIncome, DREAM_UPKEEP_UID, dreamUpkeep, dreamWorkPerWeek, freedomLevel, getDream,
  insurancePremium, isFree, loanInterest, realFreedomRatio,
} from './economy';
import {
  backToWorkEvent, burnoutEvent, dreamDoneEvent, dreamStageEvent, emergencyLoanEvent, freedomEvent,
  freedomLevelEvent, freedomThreatEvent, rollBurnout, rollPersonalEvent, rollWorldEvent,
  scamCollapseEvent, threatOverEvent, weeklyHappinessDelta,
} from './events';
import { advanceMarket, snapshotMarket } from './market';
import { dreamNews, emergencyNews, freedomNews, scamNews, type NewsItem } from './news';
import { expireOffers, refillBoard } from './offers';
import { Rng } from './rng';
import * as R from './rules';
import type { GameEvent, OwnedAsset, PlayerState, PlayerWeekReport, WorldState } from './types';

/** Афера, которая рухнет на этой неделе, уже не платит. */
function isCollapsing(asset: OwnedAsset, week: number): boolean {
  return asset.collapseWeek !== undefined && asset.collapseWeek <= week;
}

/** Шаг 2: зарплата, доходы, расходы, личные события, счастье. */
function settlePlayer(world: WorldState, player: PlayerState, rng: Rng): PlayerWeekReport {
  const week = world.week;
  const events: GameEvent[] = [];

  // Без работы нет ни зарплаты, ни выгорания (ГПСЧ при этом не трогаем).
  const laidOff = player.layoffWeeks > 0;
  const working = player.employed && !laidOff;
  if (!working) player.extraShift = false;
  const burnout = working && rollBurnout(player, rng);
  if (burnout) events.push(burnoutEvent());
  const salary = working
    ? Math.round(player.salary * (player.extraShift ? 1 + R.EXTRA_SHIFT_BONUS : 1) * (burnout ? R.BURNOUT_SALARY_MUL : 1))
    : 0;

  const assetIncome = player.owned
    .map((a) => ({ assetUid: a.uid, amount: isCollapsing(a, week) ? 0 : currentIncome(a, world.market, player.knowledge) }))
    .filter((e) => e.amount > 0);
  const upkeep = player.owned.filter((a) => a.upkeep > 0).map((a) => ({ assetUid: a.uid, amount: a.upkeep }));
  const dreamCost = dreamUpkeep(player); // готовая мечта стоит денег каждую неделю
  if (dreamCost > 0) upkeep.push({ assetUid: DREAM_UPKEEP_UID, amount: dreamCost });
  const living = player.living;
  const interest = player.loans.reduce((sum, l) => sum + loanInterest(l), 0);
  const insurance = player.insured ? insurancePremium(player) : 0;

  // Повышение меняет зарплату/расходы со следующей недели — уже после начислений выше.
  // Бросок личного события использует покрытие этой недели; оформление уже стоит премию.
  const eventPlayer = { ...player, insured: insuranceActive(player, week) };
  let personal = rollPersonalEvent(eventPlayer, rng);
  if (personal?.id === 'layoff') {
    if (player.lastLayoffWeek > 0 && week - player.lastLayoffWeek < R.LAYOFF_COOLDOWN) personal = null;
    else {
      player.layoffWeeks = Number(personal.params!.weeks);
      player.lastLayoffWeek = week;
    }
  }
  player.salary = eventPlayer.salary;
  player.living = eventPlayer.living;
  if (personal) events.push(personal);
  if (laidOff) {
    player.layoffWeeks -= 1;
    if (player.layoffWeeks === 0) events.push({ id: 'layoffOver', tone: 'good', params: {} });
  }
  if (player.insured && week === player.insuranceFrom) events.push({ id: 'insuranceStarted', tone: 'good', params: {} });
  const eventsCash = events.reduce((sum, e) => sum + (e.cashDelta ?? 0), 0);

  const projection = archProjection(world, player);
  const arch = world.archipelago && !player.isBot ? projection.lines : null;
  if (arch) {
    arch.bankInterest = world.archipelago!.loans.filter((l) => l.borrower === 'npc' && l.startWeek <= week && l.dueWeek >= week)
      .reduce((n, l) => n + Math.round(l.principal * l.weeklyRate), 0);
    arch.repairs = world.archipelago!.pendingRepairs ?? 0;
    world.archipelago!.pendingRepairs = 0;
    world.archipelago!.log.bankInterest += arch.bankInterest;
    world.archipelago!.log.businessIncome += arch.businesses - arch.managers - arch.upkeep - arch.insurance;
  }
  const extraFish = fishBonus(world, player);
  if (extraFish) {
    const fish = player.owned.find((a) => !a.damaged && (a.defId === 'boat' || a.defId === 'smokehouse'));
    const line = assetIncome.find((l) => l.assetUid === fish?.uid);
    if (line) line.amount += extraFish;
    else if (fish) assetIncome.push({ assetUid: fish.uid, amount: extraFish });
  }
  const archNet = arch ? linesNet(arch) : projection.income - projection.expenses;
  if (world.archipelago && player.isBot) {
    const shared = world.archipelago.businesses.filter((b) => b.stakes.some((s) => s.playerId === 'p1'));
    world.archipelago.log.paidToNeighbors += projection.management + shared.reduce((n, b) => {
      const gross = grossIncome(world, world.archipelago!, b);
      const share = b.stakes.find((s) => s.playerId === player.id)?.share ?? 0;
      return n + Math.round((gross - managerFee(gross, b.manager)) * share);
    }, 0);
  }
  const net = archNet + salary
    + assetIncome.reduce((s, e) => s + e.amount, 0)
    - upkeep.reduce((s, e) => s + e.amount, 0)
    - living - interest - insurance + eventsCash;
  player.cash += net + (arch?.repairs ?? 0);

  const before = player.happiness;
  player.happiness = clamp(before + weeklyHappinessDelta(player) + (arch ? OWNER_DAY_JOY * world.archipelago!.businesses.filter((b) => b.manager === 'owner').length : 0), 0, 100);

  return {
    playerId: player.id,
    salary,
    assetIncome,
    upkeep,
    living,
    interest,
    insurance,
    eventsCash,
    net,
    cashAfter: player.cash,
    happinessDelta: player.happiness - before,
    events,
    lostAssetUids: [],
    freedomReached: false,
    arch,
  };
}

/** Шаг 4: аферы исчезают. */
function collapseScams(world: WorldState, reports: Record<string, PlayerWeekReport>, news: NewsItem[]): void {
  for (const player of world.players) {
    const lost = player.owned.filter((a) => isCollapsing(a, world.week));
    if (lost.length === 0) continue;
    player.owned = player.owned.filter((a) => !isCollapsing(a, world.week));
    for (const a of lost) {
      reports[player.id].lostAssetUids.push(a.uid);
      reports[player.id].events.push(scamCollapseEvent(a.uid, a.defId));
      if (player.isBot) news.push(scamNews(player, a.defId));
    }
  }
}

/** Шаг 5: если монет меньше нуля — ростовщик закрывает дыру. */
function coverNegativeCash(world: WorldState, reports: Record<string, PlayerWeekReport>, news: NewsItem[]): void {
  for (const player of world.players) {
    if (player.cash >= 0) continue;
    const amount = Math.ceil(-player.cash / R.EMERGENCY_STEP) * R.EMERGENCY_STEP;
    addLoan(world, player, amount, true);
    player.cash += amount;
    reports[player.id].events.push(emergencyLoanEvent(amount));
    if (player.isBot) news.push(emergencyNews(player, amount));
  }
}

/** Шаг 6а: стройка мечты — каждый строящийся этап получает дни работы этой недели. */
function progressDreams(world: WorldState, reports: Record<string, PlayerWeekReport>, news: NewsItem[]): void {
  for (const player of world.players) {
    const dream = player.dream;
    if (!dream || !dream.building) continue;
    const def = getDream(dream.id);
    dream.progress += dreamWorkPerWeek(player);
    if (dream.progress < def.stages[dream.built].work) continue;
    const finished = dream.built;
    dream.built += 1;
    dream.building = false;
    dream.progress = 0;
    if (dream.built >= def.stages.length) {
      dream.doneWeek = world.week;
      reports[player.id].events.push(dreamDoneEvent(def));
      news.push(dreamNews(player));
    } else {
      reports[player.id].events.push(dreamStageEvent(def, finished));
    }
  }
}

/** Шаг 6: проверка свободы (по настоящему пассивному доходу, без афер). */
function checkFreedom(world: WorldState, reports: Record<string, PlayerWeekReport>, news: NewsItem[]): void {
  for (const player of world.players) {
    if (player.freedomWeek !== null || !isFree(player, world.market, world)) continue;
    player.freedomWeek = world.week;
    reports[player.id].freedomReached = true;
    reports[player.id].events.push(freedomEvent());
    news.push(freedomNews(player, world.week));
  }
}

/** Шаг 6б: уровни свободы. Первый уровень празднует freedomEvent, здесь — запас прочности (2 и выше). */
function updateLevels(world: WorldState, reports: Record<string, PlayerWeekReport>): void {
  for (const player of world.players) {
    const level = freedomLevel(realFreedomRatio(player, world.market, world));
    if (level <= player.bestLevel) continue;
    player.bestLevel = level;
    if (level >= 2) reports[player.id].events.push(freedomLevelEvent(level));
  }
}

/** Шаг 6в: свобода под угрозой. Без работы и без запаса — недели считаются, потом возврат на работу. */
function checkThreat(world: WorldState, reports: Record<string, PlayerWeekReport>): void {
  for (const player of world.players) {
    if (player.employed) continue;
    const events = reports[player.id].events;
    if (isFree(player, world.market, world)) {
      if (player.threatWeeks > 0) {
        events.push(threatOverEvent());
        player.threatWeeks = 0;
      }
      continue;
    }
    player.threatWeeks += 1;
    if (player.threatWeeks >= R.THREAT_WEEKS) {
      returnToJob(player);
      events.push(backToWorkEvent(player.salary));
    } else {
      events.push(freedomThreatEvent(R.THREAT_WEEKS - player.threatWeeks));
    }
  }
}

function resetWeeklyFlags(player: PlayerState): void {
  player.studiedThisWeek = false;
  player.restedThisWeek = false;
  player.extraShift = false;
}

/** Шаги 2–8. `world` — собственная копия, её можно менять. `news` — новости ходов ботов. */
export function settleWeek(world: WorldState, news: NewsItem[]): WorldState {
  const rng = new Rng(world.rng);
  const endedWeek = world.week;
  const snapshot = snapshotMarket(world.market);
  for (const player of world.players) {
    if (player.choice && !['partner', 'bankLoan', 'bizBuyer'].includes(player.choice.kind) && (player.choice.expiresWeek ?? player.choice.week) <= endedWeek) resolvePendingChoice(world, player, false);
  }

  normalizeManagers(world);
  const reports: Record<string, PlayerWeekReport> = {};
  for (const player of world.players) {
    reports[player.id] = settlePlayer(world, player, rng);
    if (player.isBot && reports[player.id].events.some((e) => e.id === 'layoff')) {
      news.push({ playerId: player.id, kind: 'layoff' });
    }
  }

  const worldEvents = rollWorldEvent(world, rng, reports);
  settleArchWeek(world, reports, worldEvents, rng);
  collapseScams(world, reports, news);
  settleLent(world, reports);
  coverNegativeCash(world, reports, news);
  progressDreams(world, reports, news);
  checkFreedom(world, reports, news);
  updateLevels(world, reports);
  checkThreat(world, reports);
  for (const player of world.players) settleGoals(world, player, reports[player.id]);
  finishArchWeek(world, reports);
  for (const player of world.players) generateChoice(world, player, rng);
  for (const player of world.players) reports[player.id].cashAfter = player.cash;

  world.week = endedWeek + 1;
  advanceMarket(world.market, snapshot, world.week, rng);
  expireOffers(world);
  refillBoard(world, rng);
  world.players.forEach(resetWeeklyFlags);

  world.rng = rng.state;
  world.lastReport = { week: endedWeek, worldEvents, players: reports, news };
  return world;
}
