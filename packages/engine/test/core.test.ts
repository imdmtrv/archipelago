import { describe, expect, it } from 'vitest';
import { POLICIES, runBotTurn } from '../src/bots';
import { applyAction } from '../src/reducer';
import type { Action, WorldState } from '../src/types';
import { deepFreeze, giveAsset, newWorld, player, putOffer } from './helpers';

/** Сценарий человека: играет «бережливой» политикой — так в тесте участвуют все действия. */
function playWeeks(seed: number, weeks: number): WorldState {
  let world = newWorld(seed);
  for (let i = 0; i < weeks; i++) {
    world = runBotTurn(world, 'p1', POLICIES.saver).world;
    world = applyAction(world, { type: 'endWeek' }).world;
  }
  return world;
}

describe('createWorld', () => {
  it('создаёт человека и трёх ботов, неделя 1, полная доска', () => {
    const world = newWorld(7);
    expect(world.week).toBe(1);
    expect(world.version).toBe(5);
    expect(world.players.map((p) => p.id)).toEqual(['p1', 'bot-mia', 'bot-timur', 'bot-boris']);
    expect(world.players[0]).toMatchObject({ name: 'Аня', islandName: 'Чайка', isBot: false, cash: 600, happiness: 70 });
    // Второй акт: все на работе, мечта только у человека.
    expect(world.players.every((p) => p.employed && p.threatWeeks === 0 && p.bestLevel === 0)).toBe(true);
    expect(world.players[0].dream).toEqual({ id: 'schooner', built: 0, building: false, progress: 0, doneWeek: null });
    expect(world.players.slice(1).every((p) => p.dream === null)).toBe(true);
    expect(world.players.slice(1).map((p) => p.botStyle)).toEqual(['saver', 'spender', 'gambler']);
    expect(world.offers).toHaveLength(4);
    expect(world.lastReport).toBeNull();
  });
});

describe('детерминизм', () => {
  it('одинаковый сид и действия → одинаковый мир', () => {
    expect(JSON.stringify(playWeeks(123, 60))).toBe(JSON.stringify(playWeeks(123, 60)));
  });

  it('разные сиды → разные миры', () => {
    expect(JSON.stringify(playWeeks(1, 10))).not.toBe(JSON.stringify(playWeeks(2, 10)));
  });

  it('мир переживает JSON-сохранение без потерь', () => {
    const world = playWeeks(5, 20);
    const restored = JSON.parse(JSON.stringify(world)) as WorldState;
    const a = applyAction(world, { type: 'endWeek' }).world;
    const b = applyAction(restored, { type: 'endWeek' }).world;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('чистота', () => {
  it('ни одно действие не меняет входной мир', () => {
    const base = newWorld(9);
    const offer = putOffer(base, 'boat', { price: 100 });
    const damaged = giveAsset(base, 'p1', 'boat', { damaged: true });
    player(base).loans.push({ uid: 'L1', principal: 200, weeklyRate: 0.015, emergency: false });
    player(base).freedomWeek = 1; // иначе нельзя уйти с работы
    const snapshot = JSON.stringify(base);
    deepFreeze(base);

    const actions: Action[] = [
      { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid },
      { type: 'sellAsset', playerId: 'p1', assetUid: damaged.uid },
      { type: 'repairAsset', playerId: 'p1', assetUid: damaged.uid },
      { type: 'takeLoan', playerId: 'p1', amount: 100 },
      { type: 'repayLoan', playerId: 'p1', loanUid: 'L1', amount: 50 },
      { type: 'setInsurance', playerId: 'p1', on: true },
      { type: 'setExtraShift', playerId: 'p1', on: true },
      { type: 'study', playerId: 'p1' },
      { type: 'rest', playerId: 'p1' },
      { type: 'quitJob', playerId: 'p1' },
      { type: 'buildDream', playerId: 'p1' },
      { type: 'endWeek' },
    ];
    for (const action of actions) {
      const result = applyAction(base, action);
      expect(result.error, action.type).toBeUndefined();
      expect(result.world).not.toBe(base);
    }
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('возвращение на работу тоже не меняет входной мир', () => {
    const base = newWorld(9);
    player(base).freedomWeek = 1;
    player(base).employed = false;
    const snapshot = JSON.stringify(base);
    deepFreeze(base);
    const result = applyAction(base, { type: 'returnToWork', playerId: 'p1' });
    expect(result.error).toBeUndefined();
    expect(result.world).not.toBe(base);
    expect(player(result.world).employed).toBe(true);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('при отказе возвращается тот же самый объект мира', () => {
    const world = newWorld(3);
    const result = applyAction(world, { type: 'buyOffer', playerId: 'p1', offerUid: 'nope' });
    expect(result.error).toEqual({ code: 'offerGone' });
    expect(result.world).toBe(world);
  });
});
