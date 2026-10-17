import { humanBusinessCount, humanShare, grossIncome, managerFee } from './archipelago/model';
import { BUSINESSES } from './archipelago/content';
import * as AR from './archipelago/rules';
import { financeView } from './selectors';
// Развилки, цели и слухи — чистые производные данные для UI.
import { buyerAsset } from './choices';
import { GOALS } from './content';
import { currentIncome, freeSlotIndex, getDef, passiveIncome, saleValue, weeklyExpenses } from './economy';
import { goalProgress } from './goals';
import * as R from './rules';
import type { ChoiceView, GoalsView, PlayerState, RumorView, WorldState } from './types';

/** Нерешённая развилка игрока с расчётом последствий; null — развилки нет. */
export function choiceView(world: WorldState, playerId: string): ChoiceView | null {
  const player = world.players.find((p) => p.id === playerId);
  const choice = player?.choice;
  if (!player || !choice) return null;
  const ratio = (p: PlayerState) => {
    const preview = { ...world, players: world.players.map((x) => x.id === p.id ? p : x) };
    const expenses = weeklyExpenses(p, preview).total;
    return expenses > 0 ? passiveIncome(p, world.market, preview) / expenses : 0;
  };
  if (choice.kind === 'neighborLoan') {
    const amount = Number(choice.params.amount);
    const canAccept = player.cash >= amount;
    return { kind: choice.kind, uid: choice.uid, neighborId: String(choice.params.neighborId), amount,
      returnAmount: Math.round(amount * (1 + R.NEIGHBOR_LOAN_BONUS)), canAccept,
      ...(!canAccept ? { reason: { code: 'notEnoughCash' as const, missing: amount - player.cash } } : {}) };
  }
  if (choice.kind === 'fireSale') {
    const neighbor = world.players.find((p) => p.id === choice.params.neighborId);
    const asset = neighbor && buyerAsset(neighbor, choice.params.assetUid);
    if (!asset) return null;
    const slot = getDef(asset.defId).slot;
    const price = Number(choice.params.price);
    const weeklyIncome = currentIncome(asset, world.market, player.knowledge);
    const net = weeklyIncome - asset.upkeep;
    const reason = freeSlotIndex(player, slot) === null ? { code: 'slotFull' as const, slot }
      : player.cash < price ? { code: 'notEnoughCash' as const, missing: price - player.cash } : null;
    return { kind: choice.kind, uid: choice.uid, neighborId: neighbor.id, assetUid: asset.uid,
      defId: asset.defId, level: asset.level, price, usualPrice: asset.price, weeklyIncome,
      paybackWeeks: net > 0 ? Math.ceil(price / net) : null,
      freedomBefore: ratio(player), freedomAfter: ratio({ ...player, owned: [...player.owned, { ...asset, price }] }),
      canAccept: reason === null, ...(reason ? { reason } : {}) };
  }
  if (choice.kind === 'partner') {
    const a = world.archipelago;
    if (!a) return null;
    const d = BUSINESSES[choice.params.business as keyof typeof BUSINESSES];
    const half = d.price * AR.PARTNER_SHARE;
    const used = humanBusinessCount(a);
    const bot = world.players.find((p) => p.id === choice.params.botId);
    if (!bot) return null;
    const reason = a.businesses.some((b) => b.id === d.id) ? { code: 'businessTaken' as const }
      : used >= AR.MAX_HUMAN_BUSINESSES ? { code: 'businessLimit' as const }
      : player.cash < half ? { code: 'notEnoughCash' as const, missing: half - player.cash }
      : bot.cash < d.price - half ? { code: 'notEnoughCash' as const, missing: d.price - half - bot.cash } : undefined;
    return { kind: 'partner', uid: choice.uid, botId: String(choice.params.botId), business: d.id, half,
      expiresWeek: choice.expiresWeek ?? choice.week, deferred: choice.deferred ?? false,
      slot: { used, max: AR.MAX_HUMAN_BUSINESSES }, canAccept: !reason, ...(reason ? { reason } : {}) };
  }
  if (choice.kind === 'bankLoan') {
    const amount = Number(choice.params.amount), weeklyRate = Number(choice.params.weeklyRate);
    const cls = choice.params.cls as 'reliable' | 'normal' | 'risky';
    const reason = player.cash < amount ? { code: 'notEnoughCash' as const, missing: amount - player.cash } : undefined;
    return { kind: 'bankLoan', uid: choice.uid, borrower: String(choice.params.borrower), cls, amount, weeklyRate,
      term: Number(choice.params.term), weeklyInterest: Math.round(amount * weeklyRate), defaultChance: AR.BANK_DEFAULT[cls],
      crisisRumor: rumorViews(world, playerId).find((r) => r.kind === 'crisis' && r.source === 'reliable') ?? null,
      canAccept: !reason, ...(reason ? { reason } : {}) };
  }
  if (choice.kind === 'bizBuyer') {
    const a = world.archipelago, b = a?.businesses.find((b) => b.id === choice.params.business && humanShare(b) === 1);
    if (!a || !b) return null;
    const gross = grossIncome(world, a, b), def = BUSINESSES[b.id];
    const weeklyIncome = gross - managerFee(gross, b.manager) - def.upkeep
      - (a.insuredFrom !== null && def.stormRisk > 0 ? Math.round(AR.BUSINESS_INSURANCE_RATE * def.price) : 0);
    const offer = Number(choice.params.offer);
    const preview = { ...world, archipelago: { ...a, businesses: a.businesses.map((x) => x === b
      ? { ...x, stakes: [{ playerId: 'mainland', share: 1 }], manager: 'partner' as const } : x) } };
    return { kind: 'bizBuyer', uid: choice.uid, business: b.id, offer, weeklyIncome,
      weeksOfIncome: weeklyIncome > 0 ? Math.round(offer / weeklyIncome) : null,
      freedomBefore: ratio(player), freedomAfter: financeView(preview, playerId).freedomRatio };
  }
  if (choice.kind !== 'buyer') return null;
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
    kind: e.kind, source: e.source, fromWeek: e.windowStart, toWeek: e.windowStart + 1,
    exactWeek: player.knowledge >= R.RUMOR_EXACT_KNOWLEDGE ? e.week : null,
  }));
}

/** Действует ли страховка на неделе `week` (её оформляют заранее). */
export function insuranceActive(player: PlayerState, week: number): boolean {
  return player.insured && player.insuranceFrom !== null && week >= player.insuranceFrom;
}
