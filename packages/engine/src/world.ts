// Создание нового мира: человек + три соседа-бота, первая доска сделок.
import { initialMarket } from './market';
import { addLoan } from './actions';
import { PROFESSIONS } from './content';
import { newGoalsState } from './goals';
import { fillInitialBoard } from './offers';
import { Rng } from './rng';
import * as R from './rules';
import type { ProfessionId, BotStyle, DreamState, PlayerState, WorldState } from './types';

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

function newPlayer(id: string, name: string, islandName: string, profession: ProfessionId, botStyle?: BotStyle): PlayerState {
  const def = PROFESSIONS[profession];
  const player: PlayerState = {
    id,
    name,
    islandName,
    isBot: botStyle !== undefined,
    cash: def.cash,
    salary: def.salary,
    living: def.living,
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
    profession,
    layoffWeeks: 0,
    lastLayoffWeek: 0,
    choice: null,
    lastChoiceWeek: 0,
    lent: [],
    noAskUntil: {},
    // Цели — тоже только у человека.
    goals: botStyle ? null : newGoalsState(),
  };
  if (botStyle) player.botStyle = botStyle;
  return player;
}

export function createWorld(opts: { seed: number; playerName: string; islandName: string; profession?: ProfessionId }): WorldState {
  const world: WorldState = {
    version: 9,
    seed: opts.seed,
    rng: opts.seed >>> 0,
    nextUid: 1,
    week: 1,
    market: initialMarket(1),
    players: [
      newPlayer(HUMAN_ID, opts.playerName, opts.islandName, opts.profession ?? 'teacher'),
      ...BOT_ROSTER.map((b) => newPlayer(b.id, b.name, b.islandName,
        b.botStyle === 'saver' ? 'teacher' : b.botStyle === 'spender' ? 'captain' : 'keeper', b.botStyle)),
    ],
    offers: [],
    upcoming: [],
    lastReport: null,
    archipelago: null,
  };
  for (const player of world.players) {
    const loan = PROFESSIONS[player.profession].loan;
    if (loan > 0) addLoan(world, player, loan, false);
  }
  const rng = new Rng(world.rng);
  fillInitialBoard(world, rng, world.players[0].cash);
  world.rng = rng.state;
  return world;
}
