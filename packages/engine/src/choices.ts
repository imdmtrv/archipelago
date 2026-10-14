// Развилки и займы соседям: результат зависит от их настоящих наличных.
import { clamp, getDef } from './economy';
import { nextUid } from './offers';
import { Rng } from './rng';
import * as R from './rules';
import type { ChoiceKind, EngineError, PlayerState, PlayerWeekReport, WorldState } from './types';

export function buyerAsset(player: PlayerState, uid: unknown) {
  return player.owned.find((a) => a.uid === uid && !a.damaged && getDef(a.defId).kind === 'asset' && getDef(a.defId).slot !== 'finance');
}

export function generateChoice(world: WorldState, player: PlayerState, rng: Rng): void {
  if (player.isBot || player.choice || world.week < 3 || world.week - player.lastChoiceWeek < R.CHOICE_COOLDOWN) return;
  if (!rng.chance(R.CHOICE_CHANCE)) return;
  const bots = world.players.filter((p) => p.isBot);
  const neighbor = bots.find((p) => p.loans.some((l) => l.emergency)) ?? [...bots].sort((a, b) => a.cash - b.cash)[0];
  const amount = Math.round(rng.range(...R.NEIGHBOR_LOAN_ASK) / 10) * 10;
  const assets = player.owned.filter((a) => buyerAsset(player, a.uid));
  const weights: Partial<Record<ChoiceKind, number>> = {};
  if (neighbor && player.cash >= amount + 50) weights.neighborLoan = R.CHOICE_WEIGHTS.neighborLoan;
  if (player.employed && player.promotions < R.PROMOTION_MAX) weights.promotion = R.CHOICE_WEIGHTS.promotion;
  if (assets.length) weights.buyer = R.CHOICE_WEIGHTS.buyer;
  if (!Object.keys(weights).length) return;
  const kind = rng.weighted(weights as Record<ChoiceKind, number>);
  let params;
  if (kind === 'neighborLoan') params = { neighborId: neighbor!.id, amount };
  else if (kind === 'promotion') params = { salary: R.PROMOTION_SALARY, living: R.PROMOTION_LIVING };
  else {
    const asset = assets[rng.int(0, assets.length - 1)];
    params = { assetUid: asset.uid, offer: Math.round(asset.price * rng.range(...R.BUYER_PREMIUM) / 10) * 10 };
  }
  player.choice = { uid: nextUid(world, 'c'), kind, week: world.week + 1, params };
  player.lastChoiceWeek = world.week;
}

export function resolvePendingChoice(world: WorldState, player: PlayerState, accept: boolean): EngineError | null {
  const choice = player.choice;
  if (!choice) return { code: 'noChoice' };
  if (!accept) { player.choice = null; return null; }
  if (choice.kind === 'neighborLoan') {
    const amount = Number(choice.params.amount);
    if (player.cash < amount) return { code: 'notEnoughCash', missing: amount - player.cash };
    const neighbor = world.players.find((p) => p.id === choice.params.neighborId)!;
    const rng = new Rng(world.rng);
    player.cash -= amount;
    neighbor.cash += amount;
    player.lent.push({ uid: choice.uid, neighborId: neighbor.id, amount, dueWeek: world.week + rng.int(...R.NEIGHBOR_LOAN_DUE), tries: 0 });
    world.rng = rng.state;
    player.happiness = clamp(player.happiness + R.NEIGHBOR_LOAN_JOY, 0, 100);
  } else if (choice.kind === 'promotion') {
    if (!player.employed || player.promotions >= R.PROMOTION_MAX) { player.choice = null; return { code: 'noChoice' }; }
    player.salary += Number(choice.params.salary);
    player.living += Number(choice.params.living);
    player.happiness = clamp(player.happiness + R.PROMOTION_JOY, 0, 100);
    player.promotions++;
  } else {
    const asset = buyerAsset(player, choice.params.assetUid);
    if (!asset) { player.choice = null; return { code: 'noSuchAsset' }; }
    player.owned = player.owned.filter((a) => a.uid !== asset.uid);
    player.cash += Number(choice.params.offer);
  }
  player.choice = null;
  return null;
}

export function settleLent(world: WorldState, reports: Record<string, PlayerWeekReport>): void {
  for (const player of world.players) {
    player.lent = player.lent.filter((loan) => {
      if (loan.dueWeek > world.week) return true;
      const report = reports[player.id];
      const neighbor = world.players.find((p) => p.id === loan.neighborId);
      const amount = Math.round(loan.amount * (1 + R.NEIGHBOR_LOAN_BONUS));
      if (neighbor && neighbor.cash >= amount + 100) {
        neighbor.cash -= amount;
        player.cash += amount;
        report.events.push({ id: 'neighborLoanReturned', tone: 'good', params: { neighborId: loan.neighborId, amount }, cashDelta: amount });
        report.eventsCash += amount;
        report.net += amount;
        reports[neighbor.id].eventsCash -= amount;
        reports[neighbor.id].net -= amount;
        return false;
      }
      loan.tries++;
      if (loan.tries >= R.NEIGHBOR_LOAN_TRIES) {
        report.events.push({ id: 'neighborLoanLost', tone: 'bad', params: { neighborId: loan.neighborId, amount: loan.amount } });
        return false;
      }
      loan.dueWeek += R.NEIGHBOR_LOAN_RETRY;
      report.events.push({ id: 'neighborLoanLate', tone: 'neutral', params: { neighborId: loan.neighborId } });
      return true;
    });
  }
}
