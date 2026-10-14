import { describe, expect, it } from 'vitest';
import { ASSET_DEFS } from '../src/content';
import { isScamVisible } from '../src/index';
import { createOffer } from '../src/offers';
import { applyAction } from '../src/reducer';
import { Rng } from '../src/rng';
import * as R from '../src/rules';
import { offerViews } from '../src/selectors';
import { settleWeek } from '../src/week';
import { giveAsset, newWorld, player, putOffer, soloWorld } from './helpers';

const scams = ['pearlFarm', 'oysterBeds', 'tideFund'];

describe('три аферы', () => {
  it.each([1, 7, 42, 123, 2026])('на доске не больше одной аферы за 300 недель, seed %i', (seed) => {
    const world = soloWorld(seed);
    const replay = structuredClone(world);
    const seen = new Set<string>();
    for (let week = 0; week < 300; week++) {
      const offers = world.offers.filter((offer) => ASSET_DEFS[offer.defId].kind === 'scam');
      expect(offers.length).toBeLessThanOrEqual(R.MAX_SCAMS_ON_BOARD);
      expect(world.offers).toHaveLength(R.BOARD_SIZE);
      expect(world.offers).toEqual(replay.offers);
      expect(world.rng).toBe(replay.rng);
      offers.forEach((offer) => seen.add(offer.defId));
      // Часть предложений покупают, остальные истекают — проверяем оба пути пополнения.
      if (week % 2 === 0) {
        world.offers.splice(0, 1);
        replay.offers.splice(0, 1);
      }
      settleWeek(world, []);
      settleWeek(replay, []);
    }
    expect([...seen].sort()).toEqual([...scams].sort());
  });

  it.each(scams)('%s распознаётся только с нужными знаниями', (defId) => {
    const world = soloWorld();
    world.offers = [];
    putOffer(world, defId);
    const threshold = defId === 'tideFund' ? 2 : 1;
    for (let knowledge = 0; knowledge <= R.MAX_KNOWLEDGE; knowledge++) {
      player(world).knowledge = knowledge;
      expect(isScamVisible(defId, knowledge)).toBe(knowledge >= threshold);
      expect(offerViews(world, 'p1')[0].warning).toBe(knowledge >= threshold ? 'scam' : undefined);
    }
    expect(ASSET_DEFS[defId].upgrades).toBeUndefined();
  });

  it('обычные сделки не помечаются, а отсутствующий порог использует правило по умолчанию', () => {
    for (const def of Object.values(ASSET_DEFS).filter((def) => def.kind !== 'scam')) {
      expect(isScamVisible(def.id, R.MAX_KNOWLEDGE)).toBe(false);
    }
    expect(isScamVisible('missing', R.MAX_KNOWLEDGE)).toBe(false);
    const def = ASSET_DEFS.pearlFarm;
    const threshold = def.scamSightKnowledge;
    try {
      delete def.scamSightKnowledge;
      expect(isScamVisible(def.id, R.SCAM_SIGHT_KNOWLEDGE - 1)).toBe(false);
      expect(isScamVisible(def.id, R.SCAM_SIGHT_KNOWLEDGE)).toBe(true);
    } finally {
      def.scamSightKnowledge = threshold;
    }
  });

  it.each(scams)('покупка %s назначает крах в её диапазоне', (defId) => {
    const [min, max] = ASSET_DEFS[defId].collapseWeeks!;
    const seen = new Set<number>();
    for (let seed = 1; seed <= 100; seed++) {
      const world = soloWorld(seed);
      player(world).cash = 10000;
      const offer = putOffer(world, defId);
      const bought = applyAction(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid });
      expect(bought.error).toBeUndefined();
      const lifetime = player(bought.world).owned[0].collapseWeek! - world.week + 1;
      expect(lifetime).toBeGreaterThanOrEqual(min);
      expect(lifetime).toBeLessThanOrEqual(max);
      seen.add(lifetime);
    }
    expect([...seen].sort()).toEqual(Array.from({ length: max - min + 1 }, (_, i) => min + i));
  });

  it.each(['oysterBeds', 'tideFund'])('%s не окупается даже при минимальной цене и максимальном доходе', (defId) => {
    const def = ASSET_DEFS[defId];
    const minPrice = Math.max(10, Math.round(def.price * (1 - R.OFFER_PRICE_SPREAD) / 10) * 10);
    const maxIncome = Math.max(1, Math.round(def.income * (1 + R.OFFER_INCOME_SPREAD)));
    const [min, max] = def.collapseWeeks!;
    // Любая другая цена выше, а доход ниже: эти крайние отклонения покрывают весь диапазон.
    class BestOfferRng extends Rng {
      private draws = 0;
      override next(): number { return this.draws++ === 0 ? 0 : 1 - Number.EPSILON; }
    }
    for (let lifetime = min; lifetime <= max; lifetime++) {
      let world = soloWorld();
      player(world).cash = 10000;
      player(world).knowledge = R.MAX_KNOWLEDGE;
      world.market.fish = R.FISH_MAX;
      const offer = createOffer(world, new BestOfferRng(0), defId);
      expect(offer).toMatchObject({ price: minPrice, income: maxIncome });
      world.offers = [offer];
      const bought = applyAction(world, { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid });
      expect(bought.error).toBeUndefined();
      world = bought.world;
      const asset = player(world).owned[0];
      asset.collapseWeek = world.week + lifetime - 1;
      let paid = 0;
      for (let week = 0; week < lifetime; week++) {
        settleWeek(world, []);
        const report = world.lastReport!.players.p1;
        const income = report.assetIncome.find((entry) => entry.assetUid === asset.uid)?.amount ?? 0;
        const upkeep = report.upkeep.find((entry) => entry.assetUid === asset.uid)?.amount ?? 0;
        expect(income).toBe(week === lifetime - 1 ? 0 : maxIncome);
        expect(upkeep).toBe(def.upkeep);
        paid += income - upkeep;
      }
      expect(paid).toBe((lifetime - 1) * maxIncome - lifetime * def.upkeep);
      expect(paid).toBeLessThan(offer.price);
      expect(player(world).owned).toHaveLength(0);
    }
  });

  it('события и новости несут defId каждой рухнувшей аферы, включая одновременный крах', () => {
    const world = newWorld();
    for (const playerId of ['p1', 'bot-mia']) {
      for (const defId of scams) giveAsset(world, playerId, defId, { collapseWeek: world.week });
    }
    settleWeek(world, []);
    for (const playerId of ['p1', 'bot-mia']) {
      const report = world.lastReport!.players[playerId];
      expect(report.assetIncome).toEqual([]);
      expect(report.events.filter((event) => event.id === 'scamCollapse').map((event) => event.params?.defId)).toEqual(scams);
      expect(report.lostAssetUids).toHaveLength(scams.length);
      expect(player(world, playerId).owned).toHaveLength(0);
    }
    expect(world.lastReport!.news.filter((item) => item.kind === 'scam')).toEqual(
      scams.map((defId) => ({ playerId: 'bot-mia', kind: 'scam', defId })),
    );
  });
});
