import type { PlayerAction } from '../src/actions';
import type { Policy } from '../src/bots';
import {
  getDef, getDream, isSlotFull, realFreedomRatio, studyCost,
} from '../src/economy';
import * as R from '../src/rules';
import { assetViews, dreamView, financeView, offerViews } from '../src/selectors';
import { choiceView, rumorViews } from '../src/engagement';
import type { PlayerState, WorldState } from '../src/types';

/** Улучшение, которое окупается дольше, разумный игрок не делает вовсе. */
const UPGRADE_MAX_PAYBACK = 30;
/** Окупается так быстро, что его стоит сделать, даже пока на острове есть место. */
const UPGRADE_GOOD_PAYBACK = 20;

export interface SensibleOptions {
  /** Шаг между «хозяйством» и покупками: игроки второго акта пробуют мечту раньше, чем потратят деньги. */
  beforeBuying?: Policy;
  /** Сколько монет не трогать ради улучшений (сверх обычного запаса): так копят на мечту. */
  upgradeReserve?: (me: PlayerState) => number;
  /** false — разумный игрок, который никогда не улучшает своё (сравнительный прогон). */
  upgrades?: boolean;
  /** false — не тратить ход на учёбу. Нужен героической партии ролика. */
  study?: boolean;
  /** true — никогда не покупать известные движку аферы, даже без знания игрока. */
  avoidScams?: boolean;
  /** Сравнение уроков развилок и слухов на тех же сидах. */
  fireSales?: boolean;
  lendEveryone?: boolean;
  listenRumors?: boolean;
}

/**
 * Улучшение своего: когда места этого типа кончились (иначе расти негде) или когда оно окупается не хуже
 * хорошей сделки. Самое быстрое по окупаемости — первым, с тем же запасом монет, что и при покупке.
 */
function sensibleUpgrade(world: WorldState, me: PlayerState, buffer: number): PlayerAction | null {
  const best = assetViews(world, me.id)
    .flatMap((v) => (v.upgrade?.canUpgrade && v.upgrade.paybackWeeks !== null
      ? [{ uid: v.asset.uid, slot: v.def.slot, cost: v.upgrade.cost, payback: v.upgrade.paybackWeeks }]
      : []))
    .filter((u) => me.cash - u.cost >= buffer && u.payback <= UPGRADE_MAX_PAYBACK)
    .filter((u) => isSlotFull(me, u.slot) || u.payback <= UPGRADE_GOOD_PAYBACK)
    .sort((a, b) => a.payback - b.payback)[0];
  return best ? { type: 'upgradeAsset', playerId: me.id, assetUid: best.uid } : null;
}

/** Разумный игрок симулятора: сначала решает развилку, затем ведёт хозяйство. */
export function makeSensible({
  beforeBuying, upgradeReserve, upgrades = true, study = true, avoidScams = false,
  fireSales = true, lendEveryone = false, listenRumors = false,
}: SensibleOptions = {}): Policy {
  return (world, me) => {
    if (me.choice) {
      const view = choiceView(world, me.id);
      let accept = false;
      if (view?.kind === 'neighborLoan') {
        const neighbor = world.players.find((p) => p.id === view.neighborId)!;
        accept = view.canAccept && (lendEveryone || (!neighbor.loans.some((l) => l.emergency)
          && financeView(world, neighbor.id).net > 0 && me.cash - view.amount >= 150));
      } else if (view?.kind === 'fireSale') accept = fireSales && view.canAccept
        && view.paybackWeeks !== null && view.paybackWeeks <= 30 && me.cash - view.price >= 80;
      else if (view?.kind === 'buyer') accept = view.offer >= 25 * view.weeklyIncome;
      return { type: 'resolveChoice', playerId: me.id, accept };
    }
    const buffer = 80;
    const damaged = me.owned.find((a) => a.damaged && me.cash - Math.round(a.price * R.REPAIR_SHARE) >= buffer);
    if (damaged) return { type: 'repairAsset', playerId: me.id, assetUid: damaged.uid };
    const emergency = me.loans.find((l) => l.emergency);
    if (emergency && me.cash > buffer) {
      return { type: 'repayLoan', playerId: me.id, loanUid: emergency.uid, amount: Math.min(emergency.principal, me.cash - buffer) };
    }
    const cost = study ? studyCost(me) : null;
    if (study && me.knowledge === 0 && !me.studiedThisWeek && cost !== null && me.cash >= cost + 250) {
      return { type: 'study', playerId: me.id };
    }
    const stormProne = me.owned.some((a) => getDef(a.defId).stormRisk >= 0.2);
    if (stormProne && !me.insured) return { type: 'setInsurance', playerId: me.id, on: true };
    if (me.happiness < 35 && !me.restedThisWeek && me.cash >= R.REST_COST + buffer) return { type: 'rest', playerId: me.id };

    const extra = beforeBuying?.(world, me);
    if (extra) return extra;

    const views = offerViews(world, me.id);
    const rumors = listenRumors ? rumorViews(world, me.id).filter((r) => r.source === 'reliable') : [];
    const crisis = rumors.some((r) => r.kind === 'crisis');
    const preferred = new Set(rumors.flatMap((r) => r.kind === 'fishShoal' ? ['fish'] : r.kind === 'touristBoom' ? ['tourism'] : []));
    const best = views
      .filter((v) => !v.locked && !v.slotFull && !v.warning && v.def.kind !== 'status')
      .filter((v) => !avoidScams || v.def.kind !== 'scam')
      .filter((v) => !crisis || v.def.sector !== 'tourism')
      .filter((v) => v.paybackWeeks !== null && v.paybackWeeks <= 35 && me.cash - v.offer.price >= buffer)
      .sort((a, b) => Number(preferred.has(b.def.sector)) - Number(preferred.has(a.def.sector))
        || (a.paybackWeeks ?? 0) - (b.paybackWeeks ?? 0))[0];
    if (best) return { type: 'buyOffer', playerId: me.id, offerUid: best.offer.uid };

    const ownsStatus = me.owned.some((a) => getDef(a.defId).kind === 'status');
    const garden = views.find((v) => v.def.id === 'garden' && !v.slotFull && me.cash >= v.offer.price + 400);
    if (!ownsStatus && garden) return { type: 'buyOffer', playerId: me.id, offerUid: garden.offer.uid };

    return upgrades ? sensibleUpgrade(world, me, buffer + (upgradeReserve?.(me) ?? 0)) : null;
  };
}

export const sensible: Policy = makeSensible();
/** Тот же разумный игрок, но никогда не улучшает своё: с ним сравниваем, что дают улучшения. */
const noUpgrades: Policy = makeSensible({ upgrades: false });
/** Ничего не делает. Свобода недостижима. */
const idle: Policy = () => null;
/** Трудоголик: покупает как разумный, но каждую неделю на подработке и никогда не отдыхает. */
const grinder: Policy = (world, me) => {
  if (!me.extraShift) return { type: 'setExtraShift', playerId: me.id, on: true };
  const action = sensible(world, { ...me, happiness: 100 });
  return action && action.type !== 'rest' ? action : null;
};

export const ENGAGEMENT_LABELS = { noFireSales: 'Не покупает на распродажах', lend: 'Одалживает всем', rumors: 'Слушает слухи' };
export const HUMAN_POLICIES: Record<string, Policy> = {
  sensible, 'no-upgrades': noUpgrades, idle, grinder,
  [ENGAGEMENT_LABELS.noFireSales]: makeSensible({ fireSales: false }),
  [ENGAGEMENT_LABELS.lend]: makeSensible({ lendEveryone: true }),
  [ENGAGEMENT_LABELS.rumors]: makeSensible({ listenRumors: true }),
};

/** Запас, который игрок оставляет после оплаты этапа мечты. */
const DREAM_RESERVE = 150;
/** Следующий этап мечты — как только его можно начать и после оплаты остаётся запас. */
const startDreamStage: Policy = (world, me) => {
  const dream = me.dream;
  if (me.freedomWeek === null || !dream || dream.building || dream.doneWeek !== null) return null;
  const stageCost = getDream(dream.id).stages[dream.built]?.cost;
  if (stageCost === undefined || me.cash - stageCost < DREAM_RESERVE) return null;
  return dreamView(world, me.id)?.canStart ? { type: 'buildDream', playerId: me.id } : null;
};
/** Пока мечта не готова, деньги на её следующий неоплаченный этап не идут на улучшения. */
const dreamSavings = (me: PlayerState): number => {
  const dream = me.dream;
  if (me.freedomWeek === null || !dream || dream.doneWeek !== null) return 0;
  const next = dream.building ? dream.built + 1 : dream.built;
  return getDream(dream.id).stages[next]?.cost ?? 0;
};
function dreamer(quitRatio: number | null): Policy {
  const base = makeSensible({ beforeBuying: startDreamStage, upgradeReserve: dreamSavings });
  return (world, me) => {
    if (quitRatio !== null && me.employed && me.freedomWeek !== null && realFreedomRatio(me, world.market) >= quitRatio) {
      return { type: 'quitJob', playerId: me.id };
    }
    return base(world, me);
  };
}

const stayAtWork = dreamer(null);
const quitAtFreedom = dreamer(1);
const quitAt150 = dreamer(1.5);

export const ACT_LABELS = {
  stay: 'остался на работе',
  quitNow: 'ушёл сразу',
  quit150: 'ушёл при 150%',
};
export const SECOND_ACT_POLICIES: [label: string, policy: Policy][] = [
  [ACT_LABELS.stay, stayAtWork],
  [ACT_LABELS.quitNow, quitAtFreedom],
  [ACT_LABELS.quit150, quitAt150],
];
