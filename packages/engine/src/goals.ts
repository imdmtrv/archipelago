// Цели человека: порядок выдачи, настоящий прогресс и небольшие награды.
import { GOALS } from './content';
import { clamp, getDef, realFreedomRatio, realPassiveIncome, weeklyExpenses } from './economy';
import * as R from './rules';
import type { GoalsState, GoalView, PlayerState, PlayerWeekReport, WorldState } from './types';

export function newGoalsState(): GoalsState {
  const goals: GoalsState = { active: [], done: [], calmWeeks: 0, hadLoan: false, insuredStorm: false };
  fillGoals(goals);
  return goals;
}

function fillGoals(goals: GoalsState): void {
  for (const def of GOALS) {
    if (goals.active.length >= R.GOALS_ACTIVE) break;
    if (goals.active.includes(def.id) || goals.done.some((g) => g.id === def.id)) continue;
    if (def.id === 'debtFree' && !goals.hadLoan) continue;
    goals.active.push(def.id);
  }
}

export function goalProgress(world: WorldState, player: PlayerState, id: string): GoalView {
  const passive = realPassiveIncome(player, world.market);
  const freedom = Math.round(realFreedomRatio(player, world.market) * 100);
  const salary = player.employed && player.layoffWeeks === 0
    ? Math.round(player.salary * (player.extraShift ? 1 + R.EXTRA_SHIFT_BONUS : 1)) : 0;
  const progress: Record<string, [number, number]> = {
    study: [Math.min(player.knowledge, 1), 1],
    cushion: [player.cash, 3 * weeklyExpenses(player).total],
    sectors: [new Set(player.owned.filter((a) => getDef(a.defId).kind === 'asset').map((a) => getDef(a.defId).sector)).size, 3],
    passive100: [passive, 100],
    upgrade: [Number(player.owned.some((a) => a.level >= 2)), 1],
    noLoanShark: [player.goals?.calmWeeks ?? 0, 15],
    share30: [salary + passive > 0 ? Math.round(passive / (salary + passive) * 100) : 0, 30],
    halfway: [freedom, 50],
    insuredStorm: [Number(player.goals?.insuredStorm ?? false), 1],
    debtFree: [Number(!!player.goals?.hadLoan && player.loans.length === 0), 1],
    level150: [freedom, 150],
  };
  const [value, target] = progress[id];
  return { id, value, target, reward: GOALS.find((g) => g.id === id)!.reward };
}

export function settleGoals(world: WorldState, player: PlayerState, report: PlayerWeekReport): void {
  const goals = player.goals;
  if (player.isBot || !goals) return;
  goals.calmWeeks = report.events.some((e) => e.id === 'emergencyLoan') ? 0 : goals.calmWeeks + 1;
  goals.hadLoan ||= player.loans.some((l) => !l.emergency);
  // Проверяем и новые цели, и прогресс после наград в той же неделе.
  while (true) {
    fillGoals(goals);
    const complete = goals.active.map((id) => goalProgress(world, player, id)).filter((g) => g.value >= g.target);
    if (!complete.length) break;
    for (const goal of complete) {
      goals.active = goals.active.filter((id) => id !== goal.id);
      goals.done.push({ id: goal.id, week: world.week });
      player.cash += goal.reward.cash;
      const beforeJoy = player.happiness;
      player.happiness = clamp(player.happiness + goal.reward.joy, 0, 100);
      report.happinessDelta += player.happiness - beforeJoy;
      report.events.push({ id: 'goalDone', tone: 'good', params: { goalId: goal.id }, cashDelta: goal.reward.cash });
      report.eventsCash += goal.reward.cash;
      report.net += goal.reward.cash;
    }
  }
}
