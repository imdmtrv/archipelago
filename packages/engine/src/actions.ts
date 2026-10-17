import { applyArchAction } from './archipelago/actions';
// Действия игрока внутри недели (всё, кроме endWeek). Каждое либо целиком применяется, либо отказ.
import {
  freeSlotIndex, getDef, getDream, loanLimit, nextUpgrade, repairCost, saleValue, studyCost, upgradedAsset,
} from './economy';
import { nextUid } from './offers';
import { resolvePendingChoice } from './choices';
import { Rng } from './rng';
import * as R from './rules';
import type { Action, ActionResult, EngineError, OwnedAsset, PlayerState, WorldState } from './types';

export type PlayerAction = Exclude<Action, { type: 'endWeek' }>;

type Handler<A extends PlayerAction> = (world: WorldState, player: PlayerState, action: A) => EngineError | null;
const err = (code: EngineError['code']): EngineError => ({ code } as EngineError);
const missingCash = (missing: number): EngineError => ({ code: 'notEnoughCash', missing });
const needKnowledge = (level: number): EngineError => ({ code: 'needKnowledge', level });

const buyOffer: Handler<Extract<PlayerAction, { type: 'buyOffer' }>> = (world, player, action) => {
  const offer = world.offers.find((o) => o.uid === action.offerUid);
  if (!offer) return err('offerGone');
  const def = getDef(offer.defId);
  if (player.knowledge < def.minKnowledge) return needKnowledge(def.minKnowledge);
  const slotIndex = freeSlotIndex(player, def.slot);
  if (slotIndex === null) return { code: 'slotFull', slot: def.slot };
  if (player.cash < offer.price) return missingCash(offer.price - player.cash);

  player.cash -= offer.price;
  const asset: OwnedAsset = {
    uid: nextUid(world, 'a'),
    defId: offer.defId,
    boughtWeek: world.week,
    price: offer.price,
    income: offer.income,
    upkeep: offer.upkeep,
    level: 1,
    damaged: false,
    slotIndex,
  };
  if (def.collapseWeeks) {
    // Срок жизни включает неделю покупки; в неделю краха афера уже не платит.
    const rng = new Rng(world.rng);
    asset.collapseWeek = world.week + rng.int(def.collapseWeeks[0], def.collapseWeeks[1]) - 1;
    world.rng = rng.state;
  }
  player.owned.push(asset);
  world.offers = world.offers.filter((o) => o.uid !== offer.uid);
  return null;
};

const sellAsset: Handler<Extract<PlayerAction, { type: 'sellAsset' }>> = (world, player, action) => {
  const asset = player.owned.find((a) => a.uid === action.assetUid);
  if (!asset) return err('noSuchAsset');
  player.cash += saleValue(asset, world.market);
  player.owned = player.owned.filter((a) => a.uid !== asset.uid);
  return null;
};

const repairAsset: Handler<Extract<PlayerAction, { type: 'repairAsset' }>> = (_world, player, action) => {
  const asset = player.owned.find((a) => a.uid === action.assetUid);
  if (!asset) return err('noSuchAsset');
  if (!asset.damaged) return err('notDamaged');
  const cost = repairCost(asset);
  if (player.cash < cost) return missingCash(cost - player.cash);
  player.cash -= cost;
  asset.damaged = false;
  return null;
};

/**
 * Почему актив нельзя улучшить прямо сейчас; null — можно. Тот же порядок проверок показывает
 * и карточка улучшения (UpgradeView.reason), поэтому кнопка и действие не расходятся.
 */
export function upgradeError(player: PlayerState, asset: OwnedAsset): EngineError | null {
  const up = nextUpgrade(asset);
  if (!up) return err('noUpgrade');
  if (asset.damaged) return err('repairFirst');
  if (player.knowledge < up.minKnowledge) return needKnowledge(up.minKnowledge);
  if (player.cash < up.cost) return missingCash(up.cost - player.cash);
  return null;
}

/** Улучшение на том же месте: лодка → баркас → траулер. Место на острове не нужно. */
const upgradeAsset: Handler<Extract<PlayerAction, { type: 'upgradeAsset' }>> = (_world, player, action) => {
  const asset = player.owned.find((a) => a.uid === action.assetUid);
  if (!asset) return err('noSuchAsset');
  const error = upgradeError(player, asset);
  if (error) return error;
  const up = nextUpgrade(asset)!;
  player.cash -= up.cost;
  player.owned = player.owned.map((a) => (a.uid === asset.uid ? upgradedAsset(a, up) : a));
  return null;
};

function isPositiveAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount > 0;
}

const takeLoan: Handler<Extract<PlayerAction, { type: 'takeLoan' }>> = (world, player, action) => {
  if (!isPositiveAmount(action.amount)) return err('badAmount');
  const limit = loanLimit(player, world.market);
  if (limit <= 0) return err('noCredit');
  if (action.amount > limit) return { code: 'loanOverLimit', limit };
  addLoan(world, player, action.amount, false);
  player.cash += action.amount;
  return null;
};

/** Обычные кредиты и долги ростовщику копятся в одной записи каждого вида. */
export function addLoan(world: WorldState, player: PlayerState, amount: number, emergency: boolean): void {
  if (!emergency && player.goals) player.goals.hadLoan = true;
  const existing = player.loans.find((l) => l.emergency === emergency);
  if (existing) {
    existing.principal += amount;
    return;
  }
  player.loans.push({
    uid: nextUid(world, 'l'),
    principal: amount,
    weeklyRate: emergency ? R.EMERGENCY_RATE : R.LOAN_RATE,
    emergency,
  });
}

const repayLoan: Handler<Extract<PlayerAction, { type: 'repayLoan' }>> = (_world, player, action) => {
  const loan = player.loans.find((l) => l.uid === action.loanUid);
  if (!loan) return err('noSuchLoan');
  if (!isPositiveAmount(action.amount)) return err('badAmount');
  const pay = Math.min(action.amount, loan.principal); // больше долга не берём
  if (player.cash < pay) return missingCash(pay - player.cash);
  player.cash -= pay;
  loan.principal -= pay;
  if (loan.principal === 0) player.loans = player.loans.filter((l) => l.uid !== loan.uid);
  return null;
};

const setInsurance: Handler<Extract<PlayerAction, { type: 'setInsurance' }>> = (world, player, action) => {
  if (action.on && !player.insured) player.insuranceFrom = world.week + R.INSURANCE_WAIT_WEEKS;
  if (!action.on) player.insuranceFrom = null;
  player.insured = action.on;
  return null;
};

const setExtraShift: Handler<Extract<PlayerAction, { type: 'setExtraShift' }>> = (_world, player, action) => {
  if (action.on && (!player.employed || player.layoffWeeks > 0)) return err('shiftUnemployed');
  if (action.on && player.restedThisWeek) return err('shiftAfterRest');
  player.extraShift = action.on;
  return null;
};

const study: Handler<Extract<PlayerAction, { type: 'study' }>> = (_world, player) => {
  const cost = studyCost(player);
  if (cost === null) return err('maxKnowledge');
  if (player.studiedThisWeek) return err('studiedThisWeek');
  if (player.cash < cost) return missingCash(cost - player.cash);
  player.cash -= cost;
  player.knowledge += 1;
  player.studiedThisWeek = true;
  return null;
};

const rest: Handler<Extract<PlayerAction, { type: 'rest' }>> = (_world, player) => {
  if (player.restedThisWeek) return err('restedThisWeek');
  if (player.extraShift) return err('restDuringShift');
  if (player.cash < R.REST_COST) return missingCash(R.REST_COST - player.cash);
  player.cash -= R.REST_COST;
  player.happiness = Math.min(100, player.happiness + R.REST_JOY);
  player.restedThisWeek = true;
  return null;
};

// ───────────── Второй акт ─────────────

/** Возвращение на работу — своей волей или по угрозе свободе: зарплата ниже прежней, кратно 5. */
export function returnToJob(player: PlayerState): void {
  player.employed = true;
  player.threatWeeks = 0;
  player.salary = Math.max(5, Math.round((player.salary * R.RETURN_SALARY_MUL) / 5) * 5);
}

const quitJob: Handler<Extract<PlayerAction, { type: 'quitJob' }>> = (_world, player) => {
  if (player.freedomWeek === null) return err('quitBeforeFreedom');
  if (!player.employed) return err('alreadyQuit');
  player.employed = false;
  player.layoffWeeks = 0;
  player.extraShift = false;
  player.threatWeeks = 0;
  return null;
};

const returnToWork: Handler<Extract<PlayerAction, { type: 'returnToWork' }>> = (_world, player) => {
  if (player.employed) return err('alreadyEmployed');
  returnToJob(player);
  return null;
};

const buildDream: Handler<Extract<PlayerAction, { type: 'buildDream' }>> = (_world, player) => {
  const dream = player.dream;
  if (!dream) return err('noDream');
  if (player.freedomWeek === null) return err('dreamBeforeFreedom');
  if (dream.doneWeek !== null) return err('dreamDone');
  if (dream.building) return err('dreamBusy');
  const stage = getDream(dream.id).stages[dream.built];
  if (player.cash < stage.cost) return missingCash(stage.cost - player.cash);
  player.cash -= stage.cost;
  dream.building = true;
  dream.progress = 0;
  return null;
};

const resolveChoice: Handler<Extract<PlayerAction, { type: 'resolveChoice' }>> = (world, player, action) =>
  resolvePendingChoice(world, player, action.accept, action.loan);


const HANDLERS: { [T in PlayerAction['type']]: Handler<Extract<PlayerAction, { type: T }>> } = {
  buyOffer, sellAsset, repairAsset, upgradeAsset, takeLoan, repayLoan, setInsurance, setExtraShift, study, rest,
  quitJob, returnToWork, buildDream, resolveChoice,
  deferChoice: applyArchAction, buildRoute: applyArchAction, buyBusiness: applyArchAction, setManager: applyArchAction, repairBusiness: applyArchAction,
  setArchInsurance: applyArchAction, archSeen: applyArchAction,
};

export function applyPlayerAction(input: WorldState, action: PlayerAction): ActionResult {
  const handler = HANDLERS[action.type] as Handler<PlayerAction> | undefined;
  if (!handler) return { world: input, error: err('unknownAction') };
  const world = structuredClone(input);
  const player = world.players.find((p) => p.id === action.playerId);
  if (!player) return { world: input, error: err('unknownPlayer') };
  const error = handler(world, player, action);
  // Недействительное предложение покупателя снимается даже при ошибке согласия.
  if (error && action.type === 'resolveChoice' && input.players.find((p) => p.id === player.id)?.choice && !player.choice) {
    return { world, error };
  }
  return error ? { world: input, error } : { world };
}
