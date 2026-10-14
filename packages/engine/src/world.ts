// Создание нового мира: человек + три соседа-бота, первая доска сделок.
import { initialMarket } from './market';
import { fillInitialBoard } from './offers';
import { Rng } from './rng';
import * as R from './rules';
import type { BotStyle, DreamState, PlayerState, WorldState } from './types';

export const HUMAN_ID = 'p1';

export const BOT_ROSTER: { id: string; name: string; islandName: string; botStyle: BotStyle }[] = [
  { id: 'bot-mia', name: 'Мия', islandName: 'Ракушка', botStyle: 'saver' },
  { id: 'bot-timur', name: 'Тимур', islandName: 'Маяк', botStyle: 'spender' },
  { id: 'bot-boris', name: 'Борис', islandName: 'Пеликан', botStyle: 'gambler' },
];

/** Чистая мечта: ничего не построено. Используется и при миграции старых сохранений. */
export function newDreamState(): DreamState {
  return { id: R.DREAM_ID, built: 0, building: false, progress: 0, doneWeek: null };
}

function newPlayer(id: string, name: string, islandName: string, botStyle?: BotStyle): PlayerState {
  const player: PlayerState = {
    id,
    name,
    islandName,
    isBot: botStyle !== undefined,
    cash: R.START_CASH,
    salary: R.SALARY,
    living: R.LIVING,
    happiness: R.START_HAPPINESS,
    knowledge: 0,
    studiedThisWeek: false,
    restedThisWeek: false,
    extraShift: false,
    insured: false,
    insuranceFrom: null,
    loans: [],
    owned: [],
    freedomWeek: null,
    employed: true,
    threatWeeks: 0,
    bestLevel: 0,
    // Мечта есть только у человека; соседи-боты остаются на работе без мечты.
    dream: botStyle ? null : newDreamState(),
    choice: null,
    lastChoiceWeek: 0,
    promotions: 0,
    lent: [],
    // Цели — тоже только у человека. TODO(движок): начальный набор целей (первые GOALS_ACTIVE из GOALS).
    goals: botStyle ? null : { active: [], done: [], calmWeeks: 0, hadLoan: false, insuredStorm: false },
  };
  if (botStyle) player.botStyle = botStyle;
  return player;
}

export function createWorld(opts: { seed: number; playerName: string; islandName: string }): WorldState {
  const world: WorldState = {
    version: 5,
    seed: opts.seed,
    rng: opts.seed >>> 0,
    nextUid: 1,
    week: 1,
    market: initialMarket(1),
    players: [
      newPlayer(HUMAN_ID, opts.playerName, opts.islandName),
      ...BOT_ROSTER.map((b) => newPlayer(b.id, b.name, b.islandName, b.botStyle)),
    ],
    offers: [],
    upcoming: [],
    lastReport: null,
  };
  const rng = new Rng(world.rng);
  fillInitialBoard(world, rng, R.START_CASH);
  world.rng = rng.state;
  return world;
}
