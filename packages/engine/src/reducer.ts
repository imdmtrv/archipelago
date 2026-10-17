import { normalizeManagers } from './archipelago/model';
// Единая точка изменения мира. Чистая функция: вход не меняется никогда.
import { applyPlayerAction } from './actions';
import { runBots } from './bots';
import type { Action, ActionResult, WorldState } from './types';
import { settleWeek } from './week';

export function applyAction(world: WorldState, action: Action): ActionResult {
  if (action.type === 'endWeek') {
    // 1. Боты ходят после человека, 2–8. итоги недели.
    const prepared = structuredClone(world);
    normalizeManagers(prepared);
    const bots = runBots(prepared);
    return { world: settleWeek(bots.world, bots.news) };
  }
  return applyPlayerAction(world, action);
}
