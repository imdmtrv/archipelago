// Публичный API движка. UI и сцена импортируют только отсюда.
export * from './types';
export { SLOT_CAPACITY } from './slots';
export { ASSET_DEFS, DREAMS, GOALS, isScamVisible } from './content';
export { choiceView, goalsView, insuranceActive, rumorViews } from './engagement';
export { EVENT_VARIANTS } from './events';
export { createWorld } from './world';
export { migrateWorld } from './migrate';
export { applyAction } from './reducer';
export {
  getPlayer,
  financeView,
  dreamView,
  offerViews,
  assetViews,
  leaderboard,
  loanLimit,
  insurancePremium,
  studyCost,
} from './selectors';
export { freedomLevel, DREAM_UPKEEP_UID } from './economy';
export {
  REST_COST, REST_JOY, LOAN_RATE, EMERGENCY_RATE,
  FREEDOM_LEVEL_RATIOS, THREAT_WEEKS, RETURN_SALARY_MUL, DREAM_WORK_EMPLOYED, DREAM_WORK_FREE, INSURANCE_WAIT_WEEKS,
} from './rules';
