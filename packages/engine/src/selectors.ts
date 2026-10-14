// Производные данные для UI. Только чтение мира.
import { upgradeError } from './actions';
import { isScamVisible } from './content';
import {
  assetsValue, currentIncome, dreamWorkPerWeek, freedomLevel, getDef, getDream, isSlotFull,
  maxLevel, nextUpgrade, offerIncome, passiveIncome, repairCost, saleValue, totalDebt, upgradedAsset,
  upgradeIncomeGain, weeklyExpenses,
  loanLimit as playerLoanLimit,
} from './economy';
import * as R from './rules';
import type {
  AssetView, DreamView, FinanceView, LeaderboardRow, MarketState, Offer, OfferView, OwnedAsset, PlayerState,
  UpgradeDef, UpgradeView, WorldState,
} from './types';

export { insurancePremium, studyCost } from './economy';

/** Игрок по id. Неизвестный id — ошибка программиста, а не игрока. */
export function getPlayer(world: WorldState, playerId: string): PlayerState {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Unknown player id: ${playerId}`);
  return player;
}

/** Доля свободы, как её показывает шкала: пассивный доход (как его видит игрок) / расходы. */
function shownFreedomRatio(player: PlayerState, market: MarketState): number {
  const total = weeklyExpenses(player).total;
  return total > 0 ? passiveIncome(player, market) / total : 0;
}

export function financeView(world: WorldState, playerId: string): FinanceView {
  const player = getPlayer(world, playerId);
  const salary = player.employed && player.layoffWeeks === 0
    ? Math.round(player.salary * (player.extraShift ? 1 + R.EXTRA_SHIFT_BONUS : 1))
    : 0;
  const passive = passiveIncome(player, world.market);
  const expenses = weeklyExpenses(player);
  const debt = totalDebt(player);
  const freedomRatio = expenses.total > 0 ? passive / expenses.total : 0;
  return {
    salary,
    passiveIncome: passive,
    expenses,
    net: salary + passive - expenses.total,
    freedomRatio,
    netWorth: player.cash + assetsValue(player, world.market) - debt,
    debt,
    employed: player.employed,
    level: freedomLevel(freedomRatio),
  };
}

/**
 * Доля свободы сразу после покупки предложения: тот же расчёт, что у шкалы, на копии игрока
 * с условным новым активом. Копия поверхностная — расчёты только читают игрока, а глубокое
 * копирование на каждое предложение заметно замедляло ботов.
 */
function freedomAfterBuying(world: WorldState, player: PlayerState, offer: Offer): number {
  const preview: PlayerState = {
    ...player,
    owned: [...player.owned, {
      uid: 'preview',
      defId: offer.defId,
      boughtWeek: world.week,
      price: offer.price,
      income: offer.income,
      upkeep: offer.upkeep,
      level: 1,
      damaged: false,
      slotIndex: 0,
    }],
  };
  return shownFreedomRatio(preview, world.market);
}

/**
 * Доля свободы сразу после улучшения — тот же поверхностный предпросмотр, что и у покупки.
 * Улучшить можно только целый актив, поэтому в предпросмотре он целый, даже если сейчас повреждён.
 */
function freedomAfterUpgrade(world: WorldState, player: PlayerState, asset: OwnedAsset, up: UpgradeDef): number {
  const preview: PlayerState = {
    ...player,
    owned: player.owned.map((a) => (a.uid === asset.uid ? { ...upgradedAsset(a, up), damaged: false } : a)),
  };
  return shownFreedomRatio(preview, world.market);
}

/** Следующее улучшение актива; null — улучшать нечего. */
function upgradeView(world: WorldState, player: PlayerState, asset: OwnedAsset): UpgradeView | null {
  const up = nextUpgrade(asset);
  if (!up) return null;
  const incomeGain = upgradeIncomeGain(asset, up, world.market, player.knowledge);
  const netGain = incomeGain - up.upkeep;
  const reason = upgradeError(player, asset);
  const view: UpgradeView = {
    def: up,
    toLevel: asset.level + 1,
    cost: up.cost,
    incomeGain,
    upkeepGain: up.upkeep,
    netGain,
    paybackWeeks: netGain > 0 ? Math.ceil(up.cost / netGain) : null,
    freedomAfter: freedomAfterUpgrade(world, player, asset, up),
    canUpgrade: reason === null,
  };
  if (reason !== null) view.reason = reason;
  return view;
}

export function offerViews(world: WorldState, playerId: string): OfferView[] {
  const player = getPlayer(world, playerId);
  return world.offers.map((offer) => {
    const def = getDef(offer.defId);
    const expectedIncome = offerIncome(offer, world.market, player.knowledge);
    const net = expectedIncome - offer.upkeep;
    const view: OfferView = {
      offer,
      def,
      expectedIncome,
      upkeep: offer.upkeep,
      net,
      paybackWeeks: net > 0 ? Math.ceil(offer.price / net) : null,
      weeksLeft: offer.expiresWeek - world.week,
      locked: player.knowledge < def.minKnowledge,
      canAfford: player.cash >= offer.price,
      slotFull: isSlotFull(player, def.slot),
      freedomAfter: freedomAfterBuying(world, player, offer),
    };
    if (isScamVisible(def.id, player.knowledge)) view.warning = 'scam';
    return view;
  });
}

export function assetViews(world: WorldState, playerId: string): AssetView[] {
  const player = getPlayer(world, playerId);
  return player.owned.map((asset) => {
    const def = getDef(asset.defId);
    return {
      asset,
      def,
      level: asset.level,
      maxLevel: maxLevel(def),
      currentIncome: currentIncome(asset, world.market, player.knowledge),
      upkeep: asset.upkeep,
      saleValue: saleValue(asset, world.market),
      repairCost: asset.damaged ? repairCost(asset) : 0,
      upgrade: upgradeView(world, player, asset),
    };
  });
}

/** Мечта игрока: состояние стройки и можно ли начать следующий этап. null — у игрока мечты нет (соседи-боты). */
export function dreamView(world: WorldState, playerId: string): DreamView | null {
  const player = getPlayer(world, playerId);
  const state = player.dream;
  if (!state) return null;
  const def = getDream(state.id);
  const done = state.doneWeek !== null;
  const stageIndex = Math.min(Math.max(state.built, 0), def.stages.length);
  const stage = done ? null : (def.stages[stageIndex] ?? null);
  const workPerWeek = dreamWorkPerWeek(player);

  let weeksLeft = 0;
  if (stage) {
    const daysLeft = state.building ? stage.work - state.progress : stage.work;
    weeksLeft = Math.max(0, Math.ceil(daysLeft / workPerWeek));
  }

  let reason: DreamView['reason'];
  let missingCash: number | undefined;
  if (player.freedomWeek === null) reason = 'beforeFreedom';
  else if (done || !stage) reason = 'done';
  else if (state.building) reason = 'building';
  else if (player.cash < stage.cost) missingCash = stage.cost - player.cash;

  const finished = structuredClone(player);
  if (finished.dream && finished.dream.doneWeek === null) finished.dream.doneWeek = world.week;

  const view: DreamView = {
    def,
    state,
    stage,
    stageIndex,
    workPerWeek,
    weeksLeft,
    canStart: reason === undefined && missingCash === undefined,
    freedomAfterDone: shownFreedomRatio(finished, world.market),
  };
  if (reason !== undefined) view.reason = reason;
  if (missingCash !== undefined) view.missingCash = missingCash;
  return view;
}

export function leaderboard(world: WorldState): LeaderboardRow[] {
  const rows = world.players.map((player) => {
    const finance = financeView(world, player.id);
    const row: LeaderboardRow = {
      playerId: player.id,
      name: player.name,
      islandName: player.islandName,
      isBot: player.isBot,
      freedomRatio: finance.freedomRatio,
      netWorth: finance.netWorth,
      freedomWeek: player.freedomWeek,
    };
    if (player.botStyle) row.botStyle = player.botStyle;
    return row;
  });
  return rows.sort((a, b) => b.freedomRatio - a.freedomRatio || b.netWorth - a.netWorth);
}

/** Сколько ещё можно взять обычным кредитом (кратно 100). */
export function loanLimit(world: WorldState, playerId: string): number {
  return playerLoanLimit(getPlayer(world, playerId), world.market);
}
