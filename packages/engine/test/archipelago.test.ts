import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/reducer';
import { financeView } from '../src/selectors';
import { choiceView } from '../src/engagement';
import { migrateWorld } from '../src/migrate';
import { realFreedomRatio, weeklyExpenses } from '../src/economy';
import { Rng } from '../src/rng';
import { settleWeek } from '../src/week';
import { archipelagoView, ARCH_MAP_ORDER } from '../src/archipelago/view';
import { activeSets, archProjection, build, createArch, grossIncome, linesNet, routeCost } from '../src/archipelago/model';
import { generateArchChoice, settleArchWeek } from '../src/archipelago/week';
import { BUSINESSES, ISLAND_ORDER } from '../src/archipelago/content';
import * as R from '../src/archipelago/rules';
import type { Action, PendingChoice, WorldState } from '../src/types';
import { badNumbers, giveAsset, newWorld, player, soloWorld } from './helpers';

function opened(solo = true): WorldState {
  const w = solo ? soloWorld() : newWorld();
  w.archipelago = createArch(w.week);
  player(w).cash = 100000;
  player(w).living = 100;
  player(w).lastChoiceWeek = 100000;
  return w;
}
function act(w: WorldState, action: Exclude<Action, { type: 'endWeek' }>): WorldState {
  const result = applyAction(w, action);
  expect(result.error).toBeUndefined();
  return result.world;
}
function partner(w: WorldState, business = 'hotel'): PendingChoice {
  return { uid: 'partner-test', kind: 'partner', week: w.week,
    expiresWeek: w.week + R.PARTNER_WAIT_WEEKS - 1, params: { botId: 'bot-mia', business } };
}
const sumReport = (w: WorldState): number => {
  const r = w.lastReport!.players.p1;
  return r.salary + r.assetIncome.reduce((n, x) => n + x.amount, 0) - r.upkeep.reduce((n, x) => n + x.amount, 0)
    - r.living - r.interest - r.insurance + r.eventsCash + (r.arch ? linesNet(r.arch) : 0);
};

describe('opening and saves', () => {
  it('opens at 150%, with the ended week and unseen introduction', () => {
    const w = soloWorld();
    player(w).living = 100;
    giveAsset(w, 'p1', 'deposit', { income: 150, upkeep: 0 });
    const result = applyAction(w, { type: 'endWeek' }).world;
    expect(result.archipelago).toMatchObject({ openWeek: 1, seen: { intro: false, finale: false } });
    expect(result.lastReport!.players.p1.arch?.opened).toBe(true);
    expect(w.archipelago).toBeNull();
  });
  it('stays closed below 150%', () => {
    const w = soloWorld(); player(w).living = 100;
    giveAsset(w, 'p1', 'deposit', { income: 149, upkeep: 0 });
    expect(applyAction(w, { type: 'endWeek' }).world.archipelago).toBeNull();
  });
  it.each(['bestLevel', 'ratio'])('opens v8 on load by %s', (condition) => {
    const w = soloWorld();
    if (condition === 'bestLevel') player(w).bestLevel = 2;
    else { player(w).living = 100; giveAsset(w, 'p1', 'deposit', { income: 150 }); }
    const raw = { ...w, version: 8 };
    expect(migrateWorld(raw)?.archipelago?.openWeek).toBe(w.week);
    expect(w.archipelago).toBeNull();
  });
  it('migrates v8 below the threshold to a closed v9', () => {
    expect(migrateWorld({ ...soloWorld(), version: 8 })).toMatchObject({ version: 9, archipelago: null });
  });
  it.each(['partner', 'bankLoan', 'bizBuyer'] as const)('preserves a JSON save with %s choice and report', (kind) => {
    let w = opened(false);
    build(w.archipelago!, 'coldStore', 1);
    w.archipelago!.pendingRepairs = 10;
    w = settleWeek(w, []);
    const choices: Record<typeof kind, PendingChoice> = {
      partner: partner(w),
      bankLoan: { uid: 'loan', kind: 'bankLoan', week: w.week, params: { borrower: 'npc', cls: 'normal', amount: 2000, weeklyRate: 0.022, term: 8 } },
      bizBuyer: { uid: 'buyer', kind: 'bizBuyer', week: w.week, params: { business: 'coldStore', offer: 2500 } },
    };
    player(w).choice = choices[kind];
    const raw = JSON.parse(JSON.stringify(w));
    expect(migrateWorld(raw)).toEqual(w);
    expect(raw).toEqual(w);
  });
  it('rejects broken archipelago state', () => {
    const w = opened();
    w.archipelago!.routes.push('pelican', 'pelican');
    expect(migrateWorld(w)).toBeNull();
  });
  it('loads the original v9 contract without the optional repair accumulator', () => {
    const w = opened();
    delete w.archipelago!.pendingRepairs;
    expect(migrateWorld(w)).toEqual(w);
    const done = settleWeek(migrateWorld(w)!, []);
    expect(done.lastReport!.players.p1.arch!.repairs).toBe(0);
    expect(badNumbers(done)).toEqual([]);
  });
});

describe('actions, ownership and managers', () => {
  it('validates closed archipelago and bot-only attempts', () => {
    expect(applyAction(newWorld(), { type: 'buildRoute', playerId: 'p1', island: 'shell' }).error?.code).toBe('archClosed');
    expect(applyAction(opened(false), { type: 'buildRoute', playerId: 'bot-mia', island: 'shell' }).error?.code).toBe('notOwner');
  });
  it('requires a route and rejects duplicates', () => {
    let w = opened();
    expect(applyAction(w, { type: 'buyBusiness', playerId: 'p1', business: 'hotel', loan: 0 }).error?.code).toBe('noRoute');
    w = act(w, { type: 'buildRoute', playerId: 'p1', island: 'shell' });
    expect(applyAction(w, { type: 'buildRoute', playerId: 'p1', island: 'shell' }).error?.code).toBe('routeBuilt');
    w = act(w, { type: 'buyBusiness', playerId: 'p1', business: 'hotel', loan: 5000 });
    expect(player(w).loans[0].principal).toBe(5000);
    expect(applyAction(w, { type: 'buyBusiness', playerId: 'p1', business: 'hotel', loan: 0 }).error?.code).toBe('businessTaken');
  });
  it('validates loan and cash atomically', () => {
    const w = opened(); w.archipelago!.routes.push('shell'); player(w).cash = 0;
    for (const [loan, code] of [[5001, 'loanTooBig'], [NaN, 'badAmount'], [5000, 'notEnoughCash']] as const) {
      const result = applyAction(w, { type: 'buyBusiness', playerId: 'p1', business: 'hotel', loan });
      expect(result.error?.code).toBe(code); expect(result.world).toBe(w);
    }
  });
  it('rejects a fourth business and partnership with three shares', () => {
    const w = opened(false); w.archipelago!.routes = [...ISLAND_ORDER];
    for (const id of ['cannery', 'coldStore', 'shipyard'] as const) build(w.archipelago!, id, 1);
    expect(applyAction(w, { type: 'buyBusiness', playerId: 'p1', business: 'bank', loan: 0 }).error?.code).toBe('businessLimit');
    player(w).choice = partner(w);
    expect(applyAction(w, { type: 'resolveChoice', playerId: 'p1', accept: true }).error?.code).toBe('businessLimit');
    expect(choiceView(w, 'p1')).toMatchObject({ kind: 'partner', slot: { used: 3, max: 3 }, reason: { code: 'businessLimit' } });
  });
  it('selling a business frees a place', () => {
    let w = opened(); w.archipelago!.routes = [...ISLAND_ORDER];
    for (const id of ['cannery', 'coldStore', 'shipyard'] as const) build(w.archipelago!, id, 1);
    player(w).choice = { uid: 'sale', week: 1, kind: 'bizBuyer', params: { business: 'coldStore', offer: 3000 } };
    expect(choiceView(w, 'p1')).toMatchObject({ kind: 'bizBuyer', offer: 3000 });
    w = act(w, { type: 'resolveChoice', playerId: 'p1', accept: true });
    w = act(w, { type: 'buyBusiness', playerId: 'p1', business: 'bank', loan: 0 });
    expect(w.archipelago!.businesses.find((b) => b.id === 'coldStore')!.stakes[0].playerId).toBe('mainland');
  });
  it('enforces days and a single assignment per neighbor', () => {
    let w = opened(false); const a = w.archipelago!; a.routes = [...ISLAND_ORDER];
    build(a, 'hotel', 1); build(a, 'coldStore', 1);
    expect(applyAction(w, { type: 'setManager', playerId: 'p1', business: 'coldStore', manager: 'owner' }).error?.code).toBe('noDays');
    w = act(w, { type: 'setManager', playerId: 'p1', business: 'hotel', manager: { neighborId: 'bot-timur' } });
    expect(applyAction(w, { type: 'setManager', playerId: 'p1', business: 'coldStore', manager: { neighborId: 'bot-timur' } }).error?.code).toBe('managerBusy');
    const view = archipelagoView(w, 'p1')!.islands.find((x) => x.business === 'coldStore')!;
    expect(view.own!.managers.find((x) => typeof x.manager === 'object' && x.manager.neighborId === 'bot-timur')!.reason?.code).toBe('managerBusy');
  });
  it('hands excess owner days to hired managers during dream construction', () => {
    const w = opened(); build(w.archipelago!, 'hotel', 1); player(w).dream!.building = true;
    const done = settleWeek(w, []);
    expect(done.archipelago!.businesses[0].manager).toBe('hired');
    expect(done.lastReport!.players.p1.arch!.managers).toBeGreaterThan(0);
  });
  it('records intro and finale acknowledgement', () => {
    let w = opened();
    w = act(w, { type: 'archSeen', playerId: 'p1', what: 'intro' });
    w = act(w, { type: 'archSeen', playerId: 'p1', what: 'finale' });
    expect(w.archipelago!.seen).toEqual({ intro: true, finale: true });
  });
});

describe('sets, mainland and partnership deadline', () => {
  it('requires all three owned shares for a set bonus', () => {
    const w = opened(), a = w.archipelago!;
    build(a, 'cannery', 1); build(a, 'coldStore', 1);
    const before = grossIncome(w, a, a.businesses[0]);
    expect(activeSets(a)).toEqual([]);
    build(a, 'shipyard', 1, 'mainland');
    expect(grossIncome(w, a, a.businesses[0])).toBe(before);
    a.businesses[2].stakes = [{ playerId: 'p1', share: 0.5 }, { playerId: 'bot-mia', share: 0.5 }];
    expect(activeSets(a)).toEqual(['fishing']);
    expect(grossIncome(w, a, a.businesses[0])).toBe(Math.round(before * (1 + R.SET_BONUS)));
  });
  it('starts mainland at three businesses, builds cheapest every six weeks', () => {
    const w = opened();
    for (const id of ['cannery', 'hotel', 'shipyard'] as const) build(w.archipelago!, id, 1);
    let done = settleWeek(w, []);
    expect(done.archipelago!.mainlandFrom).toBe(1);
    expect(done.archipelago!.businesses.at(-1)?.id).toBe('coldStore');
    for (let i = 0; i < R.MAINLAND_STEP - 1; i++) done = settleWeek(done, []);
    expect(done.archipelago!.businesses).toHaveLength(4);
    done = settleWeek(done, []);
    expect(done.archipelago!.businesses.at(-1)?.id).toBe('bank');
  });
  it('starts mainland after fifty weeks and cancels its pending partnership', () => {
    const w = opened(false); w.week = 1 + R.MAINLAND_FALLBACK - 1;
    let done = settleWeek(w, []);
    expect(done.archipelago!.businesses).toHaveLength(0);
    player(done).choice = { ...partner(done, 'coldStore'), expiresWeek: done.week + 3 };
    done = settleWeek(done, []);
    expect(done.archipelago!.mainlandFrom).toBe(1 + R.MAINLAND_FALLBACK);
    expect(done.archipelago!.businesses[0].id).toBe('coldStore');
    expect(player(done).choice).toBeNull();
    expect(done.lastReport!.players.p1.events.some((e) => e.id === 'archMainlandBuilt')).toBe(true);
  });
  it('keeps deferred partner for four weeks, then the neighbor builds', () => {
    let w = opened(false); player(w, 'bot-mia').cash = 100000;
    player(w).choice = partner(w);
    w = act(w, { type: 'deferChoice', playerId: 'p1' });
    expect(choiceView(w, 'p1')).toMatchObject({ kind: 'partner', deferred: true, expiresWeek: 4 });
    for (let i = 0; i < R.PARTNER_WAIT_WEEKS - 1; i++) {
      w = settleWeek(w, []); expect(player(w).choice?.kind).toBe('partner');
    }
    expect(applyAction(w, { type: 'deferChoice', playerId: 'p1' }).error?.code).toBe('cannotDefer');
    w = settleWeek(w, []);
    expect(player(w).choice).toBeNull();
    expect(w.archipelago!.businesses[0].stakes).toEqual([{ playerId: 'bot-mia', share: 1 }]);
    expect(w.lastReport!.players.p1.events.some((e) => e.id === 'archNeighborBuilt')).toBe(true);
  });
  it('accepts partnership without a route and with a normal engine loan', () => {
    let w = opened(false); player(w, 'bot-mia').cash = 100000; player(w).choice = partner(w);
    w = act(w, { type: 'resolveChoice', playerId: 'p1', accept: true, loan: 2500 });
    expect(w.archipelago!.businesses[0]).toMatchObject({ manager: 'partner', stakes: [{ playerId: 'p1', share: 0.5 }, { playerId: 'bot-mia', share: 0.5 }] });
    expect(player(w).loans[0].principal).toBe(2500);
  });
  it('generates partner deadline only after the bot delay', () => {
    const w = opened(false); player(w, 'bot-mia').cash = 100000;
    w.week = w.archipelago!.openWeek + R.BOT_DELAY - 1;
    expect(generateArchChoice(w, player(w), new Rng(1))).toBe(false);
    w.week++;
    expect(generateArchChoice(w, player(w), new Rng(1))).toBe(true);
    expect(player(w).choice!.expiresWeek).toBe(player(w).choice!.week + R.PARTNER_WAIT_WEEKS - 1);
  });
  it('finale is emitted once after all routes and businesses', () => {
    const w = opened(); w.archipelago!.routes = [...ISLAND_ORDER];
    for (const id of Object.keys(BUSINESSES) as (keyof typeof BUSINESSES)[]) build(w.archipelago!, id, 1, 'mainland');
    let done = settleWeek(w, []);
    expect(done.archipelago!.finaleWeek).toBe(1);
    expect(done.lastReport!.players.p1.arch!.finale).toBe(true);
    done = settleWeek(done, []);
    expect(done.lastReport!.players.p1.arch!.finale).toBe(false);
  });
});

describe('real finances and reports', () => {
  it('adds all arch lines to net and cash and never creates pseudo-assets', () => {
    const w = opened(); const a = w.archipelago!; a.routes = ['shell']; build(a, 'hotel', 1); a.businesses[0].manager = 'hired';
    const initial = player(w).cash;
    const done = settleWeek(w, []), r = done.lastReport!.players.p1;
    expect(r.arch).not.toBeNull(); expect(r.net).toBe(sumReport(done));
    expect(r.cashAfter).toBe(initial + r.net);
    expect(player(done).owned).toEqual([]);
    expect(badNumbers(done)).toEqual([]);
  });
  it('repair appears once in the report without a second charge', () => {
    let w = opened(); build(w.archipelago!, 'coldStore', 1); w.archipelago!.businesses[0].damaged = true;
    const initial = player(w).cash;
    w = act(w, { type: 'repairBusiness', playerId: 'p1', business: 'coldStore' });
    const cost = BUSINESSES.coldStore.price * R.BUSINESS_REPAIR_SHARE;
    expect(player(w).cash).toBe(initial - cost);
    w = settleWeek(w, []);
    expect(w.lastReport!.players.p1.arch!.repairs).toBe(cost);
    expect(w.lastReport!.players.p1.net).toBe(sumReport(w));
    expect(player(w).cash).toBe(initial + w.lastReport!.players.p1.net);
    expect(settleWeek(w, []).lastReport!.players.p1.arch!.repairs).toBe(0);
  });
  it('finance includes arch income, all expenses and resale stakes', () => {
    const w = opened(); const a = w.archipelago!; a.routes = ['shell']; build(a, 'hotel', 1);
    const base = financeView({ ...w, archipelago: null }, 'p1'), f = financeView(w, 'p1'), pr = archProjection(w, player(w));
    expect(f.arch).toEqual({ income: pr.income, expenses: pr.expenses });
    expect(f.passiveIncome).toBe(base.passiveIncome + pr.income);
    expect(f.expenses.total).toBe(base.expenses.total + pr.expenses);
    expect(f.netWorth - base.netWorth).toBe(BUSINESSES.hotel.price * BUSINESSES.hotel.resaleRate);
  });
  it('neighbor management increases bot cash and real freedom, while bot arch stays null', () => {
    const w = opened(false); const a = w.archipelago!; a.routes = ['lighthouse']; build(a, 'hotel', 1);
    a.businesses[0].manager = { neighborId: 'bot-timur' }; player(w, 'bot-timur').living = 20;
    const f = financeView(w, 'bot-timur');
    expect(f.arch.income).toBeGreaterThan(20);
    expect(realFreedomRatio(player(w, 'bot-timur'), w.market, w)).toBe(f.freedomRatio);
    const done = settleWeek(w, []);
    expect(player(done, 'bot-timur').freedomWeek).toBe(1);
    expect(done.lastReport!.players['bot-timur'].arch).toBeNull();
    expect(done.archipelago!.log.paidToNeighbors).toBe(f.arch.income);
  });
  it('fish effects are real home-asset income, including effects of mainland businesses', () => {
    const w = opened(); w.archipelago!.routes = ['pelican', 'lighthouse']; w.market.fish = 0.5;
    giveAsset(w, 'p1', 'boat', { income: 100 }); build(w.archipelago!, 'cannery', 1, 'mainland'); build(w.archipelago!, 'coldStore', 1, 'mainland');
    const f = financeView(w, 'p1');
    expect(f.passiveIncome - f.arch.income).toBe(120);
    const done = settleWeek(w, []);
    expect(done.lastReport!.players.p1.assetIncome[0].amount).toBe(120);
  });
  it('bank neighbor interest is received only at maturity, projected weekly', () => {
    let w = opened(false); build(w.archipelago!, 'bank', 1); player(w, 'bot-timur').cash = 100000;
    player(w).choice = { uid: 'bank', kind: 'bankLoan', week: 1,
      params: { borrower: 'bot-timur', cls: 'normal', amount: 2000, weeklyRate: 0.022, term: 8 } };
    expect(choiceView(w, 'p1')).toMatchObject({ kind: 'bankLoan', weeklyInterest: 44, defaultChance: R.BANK_DEFAULT.normal });
    w = act(w, { type: 'resolveChoice', playerId: 'p1', accept: true });
    expect(financeView(w, 'p1').arch.income).toBe(44);
    w = settleWeek(w, []); expect(w.lastReport!.players.p1.arch!.bankInterest).toBe(0);
    w.week = 9; w = settleWeek(w, []);
    expect(w.lastReport!.players.p1.arch!.bankInterest).toBe(352);
    expect(w.archipelago!.loans).toEqual([]);
    expect(w.lastReport!.players.p1.net).toBe(sumReport(w));
  });
  it('lost principal is written off without charging cash twice', () => {
    const w = opened(); build(w.archipelago!, 'bank', 1);
    w.archipelago!.loans.push({ uid: 'default', borrower: 'npc', cls: 'risky', principal: 2000,
      weeklyRate: 0.03, startWeek: 0, dueWeek: 1, tries: 0, crisisSeen: true });
    const done = settleWeek(w, []);
    const before = player(done).cash;
    // Reuse real reports, isolate the settlement's loss branch with a deterministic RNG.
    const loan = { uid: 'default2', borrower: 'npc', cls: 'risky' as const, principal: 2000,
      weeklyRate: 0.03, startWeek: 0, dueWeek: done.week, tries: 0, crisisSeen: true };
    done.archipelago!.loans = [loan];
    const rng = new Rng(1); rng.chance = () => true;
    settleArchWeek(done, done.lastReport!.players, [], rng);
    expect(player(done).cash).toBe(before);
    expect(done.lastReport!.players.p1.arch!.bankLost).toBeGreaterThanOrEqual(2000);
    expect(done.lastReport!.players.p1.net).toBe(sumReport(done));
  });
  it('insurance starts after the waiting period and shields storm damage', () => {
    let w = opened(); build(w.archipelago!, 'hotel', 1);
    w = act(w, { type: 'setArchInsurance', playerId: 'p1', on: true });
    expect(w.archipelago!.insuredFrom).toBeGreaterThan(w.week);
    w.week = w.archipelago!.insuredFrom!;
    const done = settleWeek(w, []);
    const rng = new Rng(1); rng.int = () => ISLAND_ORDER.indexOf('shell'); rng.chance = () => true;
    settleArchWeek(done, done.lastReport!.players, [{ id: 'storm', tone: 'bad', params: {} }], rng);
    expect(done.archipelago!.businesses[0].damaged).toBe(false);
    expect(done.lastReport!.players.p1.events.some((e) => e.id === 'archStormInsured')).toBe(true);
    expect(done.lastReport!.players.p1.arch!.insurance).toBe(Math.round(R.BUSINESS_INSURANCE_RATE * BUSINESSES.hotel.price));
  });
  it('view follows map order, discounted routes, previews, sets and attention', () => {
    const w = opened(); build(w.archipelago!, 'shipyard', 1, 'mainland');
    const view = archipelagoView(w, 'p1')!;
    expect(view.islands.map((i) => i.island)).toEqual(ARCH_MAP_ORDER);
    expect(view.islands[0].route!.cost).toBe(routeCost(w.archipelago!));
    expect(view.islands[0].buy!.income).toBe(BUSINESSES.coldStore.baseIncome - BUSINESSES.coldStore.upkeep);
    expect(view.weeklyNet).toBe(financeView(w, 'p1').arch.income - financeView(w, 'p1').arch.expenses);
    expect(view.attention).toBe(true);
    expect(weeklyExpenses(player(w), w).total).toBe(financeView(w, 'p1').expenses.total);
  });
  it('is deterministic through JSON reload and continued seeded play', () => {
    const run = (reload: boolean): WorldState => {
      let w = opened(false); w.archipelago!.routes = [...ISLAND_ORDER];
      build(w.archipelago!, 'hotel', 1); build(w.archipelago!, 'coldStore', 1);
      for (let i = 0; i < 20; i++) {
        w = applyAction(w, { type: 'endWeek' }).world;
        if (reload) w = migrateWorld(JSON.parse(JSON.stringify(w)))!;
      }
      return w;
    };
    expect(run(true)).toEqual(run(false));
  });
});
