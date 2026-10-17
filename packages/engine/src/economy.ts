import { archProjection, businessValue, fishBonus } from './archipelago/model';
// Денежные расчёты, общие для редуктора, селекторов и ботов. Только чистые функции.
import { ASSET_DEFS, DREAMS } from './content';
import * as R from './rules';
import { SLOT_CAPACITY } from './slots';
import type {
  AssetDef, DreamDef, Loan, MarketState, Offer, OwnedAsset, PlayerState, Sector, SlotType, UpgradeDef, WorldState,
} from './types';

/** id строки содержания готовой мечты в отчёте недели (и якорь мечты в UI/3D). */
export const DREAM_UPKEEP_UID = 'dream';

export function getDef(defId: string): AssetDef {
  const def = ASSET_DEFS[defId];
  if (!def) throw new Error(`Unknown deal id: ${defId}`);
  return def;
}

export function getDream(dreamId: string): DreamDef {
  const def = DREAMS[dreamId];
  if (!def) throw new Error(`Unknown dream id: ${dreamId}`);
  return def;
}

export function sectorIndex(market: MarketState, sector: Sector): number {
  if (sector === 'fish') return market.fish;
  if (sector === 'tourism') return market.tourism;
  return 1;
}

/** Доход в неделю по текущему рынку для данных базового дохода и сделки. */
function incomeFor(baseIncome: number, def: AssetDef, market: MarketState, knowledge: number): number {
  if (def.kind === 'status') return 0;
  if (def.kind === 'scam') return baseIncome; // афера платит «как обещано», пока не исчезнет
  const bonus = knowledge >= R.INCOME_BONUS_KNOWLEDGE ? 1 + R.INCOME_BONUS : 1;
  return Math.round(baseIncome * sectorIndex(market, def.sector) * bonus);
}

/** Сколько актив принесёт на этой неделе (0, если повреждён). */
export function currentIncome(asset: OwnedAsset, market: MarketState, knowledge: number): number {
  if (asset.damaged) return 0;
  return incomeFor(asset.income, getDef(asset.defId), market, knowledge);
}

export function offerIncome(offer: Offer, market: MarketState, knowledge: number): number {
  return incomeFor(offer.income, getDef(offer.defId), market, knowledge);
}

// ───────────── Улучшения ─────────────

/** Сколько всего уровней у сделки: 1 — улучшений нет. */
export function maxLevel(def: AssetDef): number {
  return 1 + (def.upgrades?.length ?? 0);
}

/** Следующая ступень улучшения актива; null — улучшать нечего. */
export function nextUpgrade(asset: OwnedAsset): UpgradeDef | null {
  return getDef(asset.defId).upgrades?.[asset.level - 1] ?? null;
}

/**
 * На сколько вырастет доход в неделю по текущему рынку (без учёта поломки): разница дохода до и после,
 * поэтому округление то же, что и у настоящего дохода.
 */
export function upgradeIncomeGain(asset: OwnedAsset, up: UpgradeDef, market: MarketState, knowledge: number): number {
  const def = getDef(asset.defId);
  return incomeFor(asset.income + up.income, def, market, knowledge) - incomeFor(asset.income, def, market, knowledge);
}

/**
 * Актив после улучшения (новый объект): доход и содержание растут, а вложенное прибавляется к цене —
 * поэтому и продажа, и ремонт, и страховка считаются от всего, что в актив вложено.
 */
export function upgradedAsset(asset: OwnedAsset, up: UpgradeDef): OwnedAsset {
  return {
    ...asset,
    income: asset.income + up.income,
    upkeep: asset.upkeep + up.upkeep,
    price: asset.price + up.cost,
    level: asset.level + 1,
  };
}

export function repairCost(asset: OwnedAsset): number {
  return Math.round(asset.price * R.REPAIR_SHARE);
}

function resaleMarketFactor(def: AssetDef, market: MarketState): number {
  if (def.kind !== 'asset') return 1;
  const index = sectorIndex(market, def.sector);
  if (R.MARKET_PRICED_DEALS.includes(def.id)) return index;
  return 1 + (index - 1) * R.RESALE_MARKET_SENSITIVITY;
}

/** Сколько дадут при продаже прямо сейчас. Повреждённый — минус стоимость ремонта. */
export function saleValue(asset: OwnedAsset, market: MarketState): number {
  const def = getDef(asset.defId);
  let value = asset.price * def.resaleRate * resaleMarketFactor(def, market);
  if (asset.damaged) value -= repairCost(asset);
  return Math.max(0, Math.round(value));
}

/** Содержание мечты: платится только когда она готова целиком. */
export function dreamUpkeep(player: PlayerState): number {
  const dream = player.dream;
  return dream && dream.doneWeek !== null ? getDream(dream.id).upkeep : 0;
}

export function totalUpkeep(player: PlayerState): number {
  return player.owned.reduce((sum, a) => sum + a.upkeep, 0) + dreamUpkeep(player);
}

export function loanInterest(loan: Loan): number {
  return Math.round(loan.principal * loan.weeklyRate);
}

export function totalInterest(player: PlayerState): number {
  return player.loans.reduce((sum, l) => sum + loanInterest(l), 0);
}

export function totalDebt(player: PlayerState): number {
  return player.loans.reduce((sum, l) => sum + l.principal, 0);
}

/** Страховая премия в неделю: база + доля цены всего, что может пострадать от шторма. */
export function insurancePremium(player: PlayerState): number {
  const insured = player.owned
    .filter((a) => getDef(a.defId).stormRisk > 0)
    .reduce((sum, a) => sum + a.price, 0);
  return Math.round(R.INSURANCE_BASE + insured * R.INSURANCE_RATE);
}

export interface Expenses {
  living: number;
  upkeep: number;
  interest: number;
  insurance: number;
  total: number;
}

export function weeklyExpenses(player: PlayerState, world?: WorldState): Expenses {
  const living = player.living;
  const upkeep = totalUpkeep(player) + archProjection(world, player).expenses;
  const interest = totalInterest(player);
  const insurance = player.insured ? insurancePremium(player) : 0;
  return { living, upkeep, interest, insurance, total: living + upkeep + interest + insurance };
}

/** Ожидаемый пассивный доход по текущему рынку (как его видит игрок, включая аферы). */
export function passiveIncome(player: PlayerState, market: MarketState, world?: WorldState): number {
  return player.owned.reduce((sum, a) => sum + currentIncome(a, market, player.knowledge), 0) + fishBonus(world, player) + archProjection(world, player).income;
}

/** Настоящий пассивный доход для проверки свободы: доход афер не настоящий. */
export function realPassiveIncome(player: PlayerState, market: MarketState, world?: WorldState): number {
  return player.owned
    .filter((a) => getDef(a.defId).kind !== 'scam')
    .reduce((sum, a) => sum + currentIncome(a, market, player.knowledge), 0) + fishBonus(world, player) + archProjection(world, player).income;
}

export function isFree(player: PlayerState, market: MarketState, world?: WorldState): boolean {
  return realPassiveIncome(player, market, world) >= weeklyExpenses(player, world).total;
}

/** Доля настоящей свободы: настоящий пассивный доход / расходы (0, если расходов нет). */
export function realFreedomRatio(player: PlayerState, market: MarketState, world?: WorldState): number {
  const total = weeklyExpenses(player, world).total;
  return total > 0 ? realPassiveIncome(player, market, world) / total : 0;
}

/** Уровень свободы: сколько порогов FREEDOM_LEVEL_RATIOS достигнуто (0..3). */
export function freedomLevel(ratio: number): number {
  return R.FREEDOM_LEVEL_RATIOS.filter((threshold) => ratio >= threshold).length;
}

/** Дней работы над мечтой в неделю: пока работаешь — мало, без работы — втрое больше. */
export function dreamWorkPerWeek(player: PlayerState): number {
  return player.employed ? R.DREAM_WORK_EMPLOYED : R.DREAM_WORK_FREE;
}

/** Готовая мечта — не имущество на продажу: в assetsValue (и в капитал) она не входит. */
export function assetsValue(player: PlayerState, market: MarketState, world?: WorldState): number {
  return player.owned.reduce((sum, a) => sum + saleValue(a, market), 0)
    + (world?.archipelago?.businesses.reduce((n, b) => n + businessValue(b, player.id), 0) ?? 0)
    + (world?.archipelago && player.id === world.players[0].id ? world.archipelago.loans.reduce((n, l) => n + l.principal, 0) : 0);
}

/** Лимит обычного кредита: 5 зарплат + половина стоимости имущества − уже взятые долги. */
export function loanLimit(player: PlayerState, market: MarketState): number {
  const raw = R.LOAN_LIMIT_SALARY_WEEKS * player.salary
    + R.LOAN_LIMIT_ASSET_SHARE * assetsValue(player, market)
    - totalDebt(player);
  return Math.max(0, Math.floor(raw / R.LOAN_STEP) * R.LOAN_STEP);
}

/** Цена следующего уровня знаний; null — учиться больше нечему. */
export function studyCost(player: PlayerState): number | null {
  if (player.knowledge >= R.MAX_KNOWLEDGE) return null;
  return R.STUDY_BASE_COST * (player.knowledge + 1);
}

export function slotUsage(player: PlayerState, slot: SlotType): number {
  return player.owned.filter((a) => getDef(a.defId).slot === slot).length;
}

/** Все места этого типа заняты: расти здесь можно только улучшениями. */
export function isSlotFull(player: PlayerState, slot: SlotType): boolean {
  return slotUsage(player, slot) >= SLOT_CAPACITY[slot];
}

/** Наименьший свободный номер места в слоте; null — мест нет. */
export function freeSlotIndex(player: PlayerState, slot: SlotType): number | null {
  const taken = new Set(player.owned.filter((a) => getDef(a.defId).slot === slot).map((a) => a.slotIndex));
  for (let i = 0; i < SLOT_CAPACITY[slot]; i++) if (!taken.has(i)) return i;
  return null;
}

export function happinessJoy(player: PlayerState): number {
  const dream = player.dream;
  const dreamJoy = dream && dream.doneWeek !== null ? getDream(dream.id).joy : 0;
  return player.owned.reduce((sum, a) => sum + getDef(a.defId).joy, 0) + dreamJoy;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
