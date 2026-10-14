// Соседи-боты. Политика смотрит на мир через селекторы и выбирает следующее действие;
// действия применяются тем же applyPlayerAction, что и у человека, — никаких обходных путей.
import { applyPlayerAction, type PlayerAction } from './actions';
import { isSlotFull, studyCost } from './economy';
import { boughtNews, loanNews, repayNews, soldNews, upgradedNews, type NewsItem } from './news';
import { hashString, peekRandom } from './rng';
import * as R from './rules';
import { assetViews, loanLimit, offerViews } from './selectors';
import type { AssetView, BotStyle, OfferView, PlayerState, UpgradeView, WorldState } from './types';

export type Policy = (world: WorldState, me: PlayerState) => PlayerAction | null;

// ───────────── Общие приёмы ─────────────

function restIfTired(me: PlayerState, threshold: number, buffer: number): PlayerAction | null {
  if (me.happiness >= threshold || me.restedThisWeek || me.extraShift) return null;
  if (me.cash < R.REST_COST + buffer) return null;
  return { type: 'rest', playerId: me.id };
}

function repairDamaged(world: WorldState, me: PlayerState, buffer: number): PlayerAction | null {
  const damaged = assetViews(world, me.id)
    .filter((v) => v.asset.damaged && me.cash - v.repairCost >= buffer)
    .sort((a, b) => b.asset.income - a.asset.income);
  return damaged[0] ? { type: 'repairAsset', playerId: me.id, assetUid: damaged[0].asset.uid } : null;
}

/** Гасит долги (сначала ростовщика), оставляя на руках `keep`. */
function repayDebts(me: PlayerState, keep: number, emergencyOnly: boolean): PlayerAction | null {
  const loan = me.loans.find((l) => l.emergency) ?? (emergencyOnly ? undefined : me.loans[0]);
  if (!loan || me.cash <= keep) return null;
  return { type: 'repayLoan', playerId: me.id, loanUid: loan.uid, amount: Math.min(loan.principal, me.cash - keep) };
}

function buyable(v: OfferView): boolean {
  return !v.locked && !v.slotFull;
}

function buy(me: PlayerState, v: OfferView): PlayerAction {
  return { type: 'buyOffer', playerId: me.id, offerUid: v.offer.uid };
}

/** Актив, у которого есть следующее улучшение (вид с гарантированным `upgrade`). */
type Upgradable = AssetView & { upgrade: UpgradeView };

function upgradable(world: WorldState, me: PlayerState): Upgradable[] {
  return assetViews(world, me.id).filter((v): v is Upgradable => v.upgrade !== null);
}

/** Улучшения, доступные прямо сейчас с запасом `buffer`, — самые быстрые по окупаемости первыми. */
function affordableUpgrades(world: WorldState, me: PlayerState, buffer: number): Upgradable[] {
  return upgradable(world, me)
    .filter((v) => v.upgrade.canUpgrade && v.upgrade.paybackWeeks !== null && me.cash - v.upgrade.cost >= buffer)
    .sort((a, b) => (a.upgrade.paybackWeeks ?? 0) - (b.upgrade.paybackWeeks ?? 0));
}

function upgrade(me: PlayerState, v: AssetView): PlayerAction {
  return { type: 'upgradeAsset', playerId: me.id, assetUid: v.asset.uid };
}

/** Детерминированная «монетка» бота на эту неделю (не трогает состояние ГПСЧ). */
function botCoin(world: WorldState, me: PlayerState, purpose: string): number {
  return peekRandom(world.rng, hashString(`${me.id}:${purpose}:${world.week}`));
}

// ───────────── Мия: бережливая ─────────────

const SAVER_BUFFER = 40;
const SAVER_MAX_PAYBACK = 45;
const SAVER_SHIFT_MOOD = 55;

const saver: Policy = (world, me) => {
  const cost = studyCost(me);
  return repayDebts(me, SAVER_BUFFER, true)
    ?? repairDamaged(world, me, SAVER_BUFFER)
    // Учится сразу, чтобы видеть аферы.
    ?? (me.knowledge === 0 && !me.studiedThisWeek && cost !== null && me.cash >= cost
      ? { type: 'study', playerId: me.id } : null)
    ?? restIfTired(me, 24, SAVER_BUFFER)
    ?? saverInvest(world, me)
    // Пока силы есть — берёт подработку и откладывает.
    ?? (me.employed && me.layoffWeeks === 0 && me.happiness >= SAVER_SHIFT_MOOD && !me.extraShift && !me.restedThisWeek
      ? { type: 'setExtraShift', playerId: me.id, on: true } : null);
};

/**
 * Лучшее вложение по окупаемости: новая сделка с доски или улучшение своего.
 * Улучшает, если это окупается быстрее лучшей доступной сделки или если места этого типа кончились.
 */
function saverInvest(world: WorldState, me: PlayerState): PlayerAction | null {
  const offer = bestPaybackOffer(world, me);
  const better = affordableUpgrades(world, me, SAVER_BUFFER)
    .filter((v) => (v.upgrade.paybackWeeks ?? Infinity) <= SAVER_MAX_PAYBACK)
    .find((v) => isSlotFull(me, v.def.slot)
      || (offer !== undefined && (v.upgrade.paybackWeeks ?? Infinity) < (offer.paybackWeeks ?? Infinity)));
  if (better) return upgrade(me, better);
  return offer ? buy(me, offer) : null;
}

function bestPaybackOffer(world: WorldState, me: PlayerState): OfferView | undefined {
  return offerViews(world, me.id)
    .filter((v) => buyable(v) && v.def.kind !== 'status' && !v.warning)
    .filter((v) => v.paybackWeeks !== null && v.paybackWeeks <= SAVER_MAX_PAYBACK)
    .filter((v) => me.cash - v.offer.price >= SAVER_BUFFER)
    .sort((a, b) => (a.paybackWeeks ?? 0) - (b.paybackWeeks ?? 0))[0];
}

// ───────────── Тимур: транжира ─────────────

const SPENDER_PANIC_DEBT = 1500;
const SPENDER_UPGRADE_CHANCE = 0.04;

const spender: Policy = (world, me) => {
  const usury = me.loans.find((l) => l.emergency)?.principal ?? 0;
  // Тонет в долгах ростовщику: гасит что может и распродаёт статусные вещи, пока не выплывет.
  if (usury >= SPENDER_PANIC_DEBT) return repayDebts(me, 100, true) ?? panicSale(world, me);
  return restIfTired(me, 45, 0)
    ?? statusBuy(world, me)
    ?? (botCoin(world, me, 'asset') < 0.3 ? anyAssetBuy(world, me) : null)
    // Изредка, под настроение, улучшает самое видное — статус ему всё равно милее.
    ?? (botCoin(world, me, 'upgrade') < SPENDER_UPGRADE_CHANCE ? showyUpgrade(world, me) : null)
    ?? repayDebts(me, 200, true);
};

/** Самое дорогое улучшение, на которое хватает денег: чтобы все видели. */
function showyUpgrade(world: WorldState, me: PlayerState): PlayerAction | null {
  const pick = affordableUpgrades(world, me, 0).sort((a, b) => b.upgrade.cost - a.upgrade.cost)[0];
  return pick ? upgrade(me, pick) : null;
}

function statusBuy(world: WorldState, me: PlayerState): PlayerAction | null {
  const ownedCount = (defId: string) => me.owned.filter((a) => a.defId === defId).length;
  const best = offerViews(world, me.id)
    .filter((v) => buyable(v) && v.canAfford && v.def.kind === 'status' && ownedCount(v.def.id) < 2)
    .sort((a, b) => b.offer.price - a.offer.price)[0];
  return best ? buy(me, best) : null;
}

function anyAssetBuy(world: WorldState, me: PlayerState): PlayerAction | null {
  const pick = offerViews(world, me.id)
    .filter((v) => buyable(v) && v.canAfford && v.def.kind === 'asset' && v.paybackWeeks !== null)
    .sort((a, b) => a.offer.price - b.offer.price)[0];
  return pick ? buy(me, pick) : null;
}

/** Продаёт самую прожорливую статусную вещь. */
function panicSale(world: WorldState, me: PlayerState): PlayerAction | null {
  const victim = assetViews(world, me.id)
    .filter((v) => v.def.kind === 'status')
    .sort((a, b) => b.upkeep - a.upkeep)[0];
  return victim ? { type: 'sellAsset', playerId: me.id, assetUid: victim.asset.uid } : null;
}

// ───────────── Борис: рисковый ─────────────

const GAMBLER_RICH = 600;
const GAMBLER_KEEP = 250;

const gambler: Policy = (world, me) =>
  restIfTired(me, 15, 0)
  ?? repairDamaged(world, me, GAMBLER_KEEP)
  ?? leveragedBuy(world, me)
  ?? leveragedUpgrade(world, me)
  ?? sellForJackpot(world, me)
  ?? (me.cash > GAMBLER_RICH ? repayDebts(me, GAMBLER_KEEP, false) : null);

/**
 * Когда на доске нечего взять, раздувает самый доходный актив: улучшает его, даже если для этого
 * нужен кредит, — лишь бы прибавка покрывала проценты.
 */
function leveragedUpgrade(world: WorldState, me: PlayerState): PlayerAction | null {
  const limit = loanLimit(world, me.id);
  const target = upgradable(world, me)
    .filter((v) => !v.asset.damaged && me.knowledge >= v.upgrade.def.minKnowledge)
    .filter((v) => v.upgrade.netGain > v.upgrade.cost * R.LOAN_RATE && v.upgrade.cost <= me.cash + limit)
    .sort((a, b) => b.currentIncome - a.currentIncome)[0];
  if (!target) return null;
  if (me.cash >= target.upgrade.cost) return upgrade(me, target);
  const gap = Math.ceil((target.upgrade.cost - me.cash) / R.LOAN_STEP) * R.LOAN_STEP;
  return { type: 'takeLoan', playerId: me.id, amount: Math.min(gap, limit) };
}

/** Самая доходная сделка на доске; если не хватает — берёт кредит. Аферы не распознаёт. */
function leveragedBuy(world: WorldState, me: PlayerState): PlayerAction | null {
  const limit = loanLimit(world, me.id);
  const target = incomeDeals(world, me)
    .filter((v) => v.offer.price <= me.cash + limit)[0];
  if (!target) return null;
  if (me.cash >= target.offer.price) return buy(me, target);
  const gap = Math.ceil((target.offer.price - me.cash) / R.LOAN_STEP) * R.LOAN_STEP;
  return { type: 'takeLoan', playerId: me.id, amount: Math.min(gap, limit) };
}

/** Доходные сделки, самые «жирные» первыми. */
function incomeDeals(world: WorldState, me: PlayerState): OfferView[] {
  return offerViews(world, me.id)
    .filter((v) => buyable(v) && v.def.kind !== 'status' && v.net > v.offer.price * R.LOAN_RATE)
    .sort((a, b) => b.expectedIncome - a.expectedIncome);
}

/** Ради «джекпота», на который не хватает даже с кредитом, продаёт самый скромный актив. */
function sellForJackpot(world: WorldState, me: PlayerState): PlayerAction | null {
  const jackpot = incomeDeals(world, me)[0];
  const weakest = assetViews(world, me.id)
    .filter((v) => v.def.kind === 'asset')
    .sort((a, b) => a.currentIncome - b.currentIncome)[0];
  if (!jackpot || !weakest || jackpot.expectedIncome < 2 * weakest.currentIncome) return null;
  // Одной продажи должно хватить: деньги от продажи плюс лимит (он падает на долю стоимости проданного).
  const reach = me.cash + loanLimit(world, me.id) + weakest.saleValue * (1 - R.LOAN_LIMIT_ASSET_SHARE);
  if (jackpot.offer.price > reach) return null;
  return { type: 'sellAsset', playerId: me.id, assetUid: weakest.asset.uid };
}

// ───────────── Запуск ─────────────

export const POLICIES: Record<BotStyle, Policy> = { saver, spender, gambler };

const MAX_BOT_ACTIONS = 30;

export interface BotTurn {
  world: WorldState;
  actions: PlayerAction[];
  errors: string[];
  news: NewsItem[];
}

function describe(world: WorldState, me: PlayerState, action: PlayerAction): NewsItem | null {
  switch (action.type) {
    case 'buyOffer': {
      const offer = world.offers.find((o) => o.uid === action.offerUid);
      return offer ? boughtNews(me, offer.defId) : null;
    }
    case 'sellAsset': {
      const asset = me.owned.find((a) => a.uid === action.assetUid);
      return asset ? soldNews(me, asset.defId, asset.level) : null;
    }
    case 'upgradeAsset': {
      const asset = me.owned.find((a) => a.uid === action.assetUid);
      return asset ? upgradedNews(me, asset.defId, asset.level) : null;
    }
    case 'takeLoan':
      return loanNews(me, action.amount);
    case 'repayLoan': {
      const loan = me.loans.find((l) => l.uid === action.loanUid);
      return loan ? repayNews(me, Math.min(action.amount, loan.principal)) : null;
    }
    default:
      return null;
  }
}

/** Ход одного бота: действия по одному, пока политике есть что делать. */
export function runBotTurn(world: WorldState, playerId: string, policy?: Policy): BotTurn {
  const turn: BotTurn = { world, actions: [], errors: [], news: [] };
  for (let step = 0; step < MAX_BOT_ACTIONS; step++) {
    const me = turn.world.players.find((p) => p.id === playerId);
    const decide = policy ?? (me?.botStyle ? POLICIES[me.botStyle] : undefined);
    if (!me || !decide) break;
    const action = decide(turn.world, me);
    if (!action) break;
    const result = applyPlayerAction(turn.world, action);
    if (result.error) {
      turn.errors.push(`${playerId} ${action.type}: ${result.error.code}`);
      break;
    }
    const item = describe(turn.world, me, action);
    if (item) turn.news.push(item);
    turn.actions.push(action);
    turn.world = result.world;
  }
  return turn;
}

/** Шаг 1 endWeek: все боты по очереди ходят на общей доске (человек уже выбрал первым). */
export function runBots(world: WorldState): BotTurn {
  const total: BotTurn = { world, actions: [], errors: [], news: [] };
  for (const player of world.players) {
    if (!player.isBot) continue;
    const turn = runBotTurn(total.world, player.id);
    total.world = turn.world;
    total.actions.push(...turn.actions);
    total.errors.push(...turn.errors);
    total.news.push(...turn.news);
  }
  return total;
}
