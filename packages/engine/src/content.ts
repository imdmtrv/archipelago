// Контент: все сделки архипелага. Числа — базовые, конкретное предложение отклоняется от них случайно.
import type { AssetDef, DealKind, DreamDef, GoalDef } from './types';
import * as R from './rules';

// Улучшения (`upgrades`) стоят дороже самой сделки и окупаются медленнее новой покупки: при рынке 1.0
// вторая ступень — за 20–24 недели, третья — за 28 (новые сделки — 13–22). Пока на острове есть место,
// выгоднее купить новое; когда места кончились — расти можно, вкладывая в то, что уже есть.
// У большого дела и расходы большие: содержание ступени — больше трети её дохода, а страховка считается
// от всей вложенной цены. Поэтому полностью улучшенный остров подходит к «Богатству» (200%), но не уходит
// далеко за него: дальше растут знания, доли в артели и (позже) соседние острова. Числа подобраны симулятором.

export const ASSET_DEFS: Record<string, AssetDef> = {
  boat: {
    id: 'boat', kind: 'asset',
    price: 250, income: 20, upkeep: 4, sector: 'fish', joy: 0,
    slot: 'pier', model: 'boat', minKnowledge: 0, stormRisk: 0.35, resaleRate: 0.6,
    upgrades: [
      {
        cost: 400, income: 32, upkeep: 12, minKnowledge: 0,
      },
      {
        cost: 700, income: 40, upkeep: 15, minKnowledge: 1,
      },
    ],
  },
  smokehouse: {
    id: 'smokehouse', kind: 'asset',
    price: 500, income: 35, upkeep: 6, sector: 'fish', joy: 0,
    slot: 'plot', model: 'smokehouse', minKnowledge: 0, stormRisk: 0.1, resaleRate: 0.6,
    upgrades: [
      {
        cost: 600, income: 48, upkeep: 18, minKnowledge: 0,
      },
      {
        cost: 900, income: 52, upkeep: 20, minKnowledge: 2,
      },
    ],
  },
  cottage: {
    id: 'cottage', kind: 'asset',
    price: 700, income: 38, upkeep: 6, sector: 'stable', joy: 0,
    slot: 'plot', model: 'cottage', minKnowledge: 0, stormRisk: 0.05, resaleRate: 0.85,
    upgrades: [
      {
        cost: 800, income: 52, upkeep: 18, minKnowledge: 0,
      },
      {
        cost: 1100, income: 63, upkeep: 24, minKnowledge: 1,
      },
    ],
  },
  bungalow: {
    id: 'bungalow', kind: 'asset',
    price: 600, income: 42, upkeep: 8, sector: 'tourism', joy: 0,
    slot: 'beach', model: 'bungalow', minKnowledge: 0, stormRisk: 0.3, resaleRate: 0.65,
    upgrades: [
      {
        cost: 700, income: 54, upkeep: 20, minKnowledge: 0,
      },
      {
        cost: 1000, income: 58, upkeep: 22, minKnowledge: 1,
      },
    ],
  },
  cafe: {
    id: 'cafe', kind: 'asset',
    price: 900, income: 64, upkeep: 12, sector: 'tourism', joy: 0,
    slot: 'beach', model: 'cafe', minKnowledge: 1, stormRisk: 0.15, resaleRate: 0.6,
    upgrades: [
      {
        cost: 1000, income: 76, upkeep: 28, minKnowledge: 1,
      },
      {
        cost: 1400, income: 81, upkeep: 31, minKnowledge: 2,
      },
    ],
  },
  deposit: {
    id: 'deposit', kind: 'asset',
    price: 400, income: 10, upkeep: 0, sector: 'stable', joy: 0,
    slot: 'finance', model: 'bank', minKnowledge: 0, stormRisk: 0, resaleRate: 1,
  },
  shares: {
    id: 'shares', kind: 'asset',
    price: 500, income: 28, upkeep: 0, sector: 'fish', joy: 0,
    slot: 'finance', model: 'bank', minKnowledge: 2, stormRisk: 0, resaleRate: 0.9,
  },
  pearlFarm: {
    id: 'pearlFarm', kind: 'scam',
    price: 800, income: 200, upkeep: 0, sector: 'stable', joy: 0,
    slot: 'sea', model: 'pearlFarm', minKnowledge: 0, stormRisk: 0, resaleRate: 0.2,
    collapseWeeks: [2, 5],
    scamSightKnowledge: 1,
  },
  oysterBeds: {
    id: 'oysterBeds', kind: 'scam',
    price: 700, income: 100, upkeep: 5, sector: 'fish', joy: 0,
    slot: 'sea', model: 'pearlFarm', minKnowledge: 0, stormRisk: 0, resaleRate: 0.2,
    collapseWeeks: [3, 6], scamSightKnowledge: 1,
  },
  tideFund: {
    id: 'tideFund', kind: 'scam',
    price: 600, income: 60, upkeep: 0, sector: 'stable', joy: 0,
    slot: 'finance', model: 'bank', minKnowledge: 0, stormRisk: 0, resaleRate: 0.2,
    collapseWeeks: [4, 8], scamSightKnowledge: 2,
  },
  fountain: {
    id: 'fountain', kind: 'status',
    price: 500, income: 0, upkeep: 6, sector: 'stable', joy: 3,
    slot: 'plaza', model: 'fountain', minKnowledge: 0, stormRisk: 0, resaleRate: 0.4,
  },
  statue: {
    id: 'statue', kind: 'status',
    price: 900, income: 0, upkeep: 12, sector: 'stable', joy: 5,
    slot: 'plaza', model: 'statue', minKnowledge: 0, stormRisk: 0, resaleRate: 0.3,
  },
  yacht: {
    id: 'yacht', kind: 'status',
    price: 1400, income: 0, upkeep: 35, sector: 'stable', joy: 7,
    slot: 'sea', model: 'yacht', minKnowledge: 0, stormRisk: 0.2, resaleRate: 0.5,
  },
  garden: {
    id: 'garden', kind: 'status',
    price: 140, income: 0, upkeep: 2, sector: 'stable', joy: 2,
    slot: 'plot', model: 'garden', minKnowledge: 0, stormRisk: 0, resaleRate: 0.3,
  },
};

/** Относительные веса появления на доске внутри своего типа сделки. */
export const DEAL_WEIGHTS: Record<DealKind, Record<string, number>> = {
  asset: { boat: 22, smokehouse: 16, cottage: 16, bungalow: 16, cafe: 12, deposit: 10, shares: 8 },
  status: { garden: 35, fountain: 30, statue: 20, yacht: 15 },
  scam: { pearlFarm: 30, oysterBeds: 40, tideFund: 30 },
};

/** Видна ли афера при текущих знаниях игрока. */
export function isScamVisible(defId: string, knowledge: number): boolean {
  const def = ASSET_DEFS[defId];
  return def?.kind === 'scam' && knowledge >= (def.scamSightKnowledge ?? R.SCAM_SIGHT_KNOWLEDGE);
}

/**
 * Цели на несколько недель — в порядке выдачи; видно GOALS_ACTIVE сразу. Каждая — урок о деньгах:
 * знания, подушка, разнообразие, пассивный доход, реинвестиции, жизнь без ростовщика, страховка заранее,
 * долги, доля пассивного дохода, запас прочности. Как считается прогресс — в goals.ts.
 */
export const GOALS: GoalDef[] = [
  { id: 'study', reward: { cash: 40, joy: 0 } },          // знания: уровень 1
  { id: 'cushion', reward: { cash: 50, joy: 0 } },        // наличные ≥ 3 недель всех расходов
  { id: 'sectors', reward: { cash: 60, joy: 3 } },        // доходные активы в трёх секторах
  { id: 'passive100', reward: { cash: 80, joy: 0 } },     // пассивный доход ≥ 100 в неделю
  { id: 'upgrade', reward: { cash: 60, joy: 0 } },        // улучшить любой актив
  { id: 'noLoanShark', reward: { cash: 60, joy: 0 } },    // 15 недель подряд без ростовщика
  { id: 'share30', reward: { cash: 60, joy: 0 } },        // пассивный доход ≥ 30% всех доходов
  { id: 'halfway', reward: { cash: 100, joy: 0 } },       // свобода 50%
  { id: 'insuredStorm', reward: { cash: 0, joy: 5 } },    // пережить шторм под действующей страховкой
  { id: 'debtFree', reward: { cash: 50, joy: 3 } },       // закрыть все кредиты (выдаётся, если кредит был)
  { id: 'level150', reward: { cash: 150, joy: 5 } },      // «Уверенность»: 150%
];

/** Мечты. Пока одна — шхуна; выбор мечты на старте появится вместе с профессиями. */
export const DREAMS: Record<string, DreamDef> = {
  schooner: {
    id: 'schooner',
    stages: [
      { cost: 400, work: 4 },
      { cost: 700, work: 5 },
      { cost: 900, work: 6 },
    ],
    upkeep: 20,
    joy: 4,
  },
};
