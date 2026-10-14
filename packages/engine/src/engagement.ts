// Развилки, цели и слухи — чистые производные данные для UI.
import { buyerAsset } from './choices';
import { GOALS } from './content';
import { currentIncome, passiveIncome, saleValue, weeklyExpenses } from './economy';
import { goalProgress } from './goals';
import * as R from './rules';
import type { ChoiceView, GoalsView, PlayerState, RumorView, WorldState } from './types';

/** Нерешённая развилка игрока с расчётом последствий; null — развилки нет. */
export function choiceView(world: WorldState, playerId: string): ChoiceView | null {
  const player = world.players.find((p) => p.id === playerId);
  const choice = player?.choice;
  if (!player || !choice) return null;
  const ratio = (p: PlayerState) => {
    const expenses = weeklyExpenses(p).total;
    return expenses > 0 ? passiveIncome(p, world.market) / expenses : 0;
  };
  if (choice.kind === 'neighborLoan') {
    const amount = Number(choice.params.amount);
    const canAccept = player.cash >= amount;
    return { kind: choice.kind, uid: choice.uid, neighborId: String(choice.params.neighborId), amount,
      returnAmount: Math.round(amount * (1 + R.NEIGHBOR_LOAN_BONUS)), canAccept,
      ...(!canAccept ? { reason: { code: 'notEnoughCash' as const, missing: amount - player.cash } } : {}) };
  }
  if (choice.kind === 'promotion') {
    const salaryIncrease = Number(choice.params.salary), livingIncrease = Number(choice.params.living);
    return { kind: choice.kind, uid: choice.uid, salaryIncrease, livingIncrease, netChange: salaryIncrease - livingIncrease,
      freedomBefore: ratio(player), freedomAfter: ratio({ ...player, living: player.living + livingIncrease }) };
  }
  const asset = buyerAsset(player, choice.params.assetUid);
  if (!asset) return null;
  return { kind: choice.kind, uid: choice.uid, assetUid: asset.uid, defId: asset.defId, level: asset.level,
    offer: Number(choice.params.offer), saleValue: saleValue(asset, world.market),
    weeklyIncome: currentIncome(asset, world.market, player.knowledge), freedomBefore: ratio(player),
    freedomAfter: ratio({ ...player, owned: player.owned.filter((a) => a.uid !== asset.uid) }) };
}

/** Активные и выполненные цели игрока; null — у игрока нет целей (боты). */
export function goalsView(world: WorldState, playerId: string): GoalsView | null {
  const player = world.players.find((p) => p.id === playerId);
  if (!player?.goals || player.isBot) return null;
  return { active: player.goals.active.map((id) => goalProgress(world, player, id)),
    done: player.goals.done.map((g) => ({ ...g })), total: GOALS.length };
}

/** Слухи о запланированных общих событиях, как их видит игрок (с учётом его знаний). */
export function rumorViews(world: WorldState, playerId: string): RumorView[] {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) return [];
  return [...world.upcoming].sort((a, b) => a.week - b.week).map((e) => ({
    kind: e.kind, fromWeek: e.windowStart, toWeek: e.windowStart + 1,
    exactWeek: player.knowledge >= R.RUMOR_EXACT_KNOWLEDGE ? e.week : null,
  }));
}

/** Действует ли страховка на неделе `week` (её оформляют заранее). */
export function insuranceActive(player: PlayerState, week: number): boolean {
  return player.insured && player.insuranceFrom !== null && week >= player.insuranceFrom;
}
