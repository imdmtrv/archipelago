import { BUSINESSES, ISLANDS } from './content';
type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nonnegative = (x: unknown): x is number => num(x) && x >= 0;
const week = (x: unknown): boolean => nonnegative(x) && Number.isInteger(x);
const nullableWeek = (x: unknown): boolean => x === null || week(x);
const business = (x: unknown): boolean => typeof x === 'string' && Object.hasOwn(BUSINESSES, x);
const cls = (x: unknown): boolean => ['reliable', 'normal', 'risky'].includes(String(x));
export function validArchChoice(c: unknown): boolean {
  if (!obj(c) || !obj(c.params) || !week(c.week) || typeof c.uid !== 'string') return false;
  if (c.deferred !== undefined && typeof c.deferred !== 'boolean') return false;
  if (c.expiresWeek !== undefined && (!week(c.expiresWeek) || Number(c.expiresWeek) < Number(c.week))) return false;
  const p = c.params;
  if (c.kind === 'partner') return business(p.business) && typeof p.botId === 'string';
  if (c.kind === 'bankLoan') return typeof p.borrower === 'string' && cls(p.cls)
    && nonnegative(p.amount) && nonnegative(p.weeklyRate) && week(p.term) && Number(p.term) > 0;
  return c.kind === 'bizBuyer' && business(p.business) && nonnegative(p.offer);
}
export function validArchState(x: unknown, players: string[]): boolean {
  if (x === null) return true;
  if (!obj(x) || !week(x.openWeek) || !nullableWeek(x.insuredFrom) || !nullableWeek(x.mainlandFrom) || !nullableWeek(x.finaleWeek)
    || !obj(x.seen) || typeof x.seen.intro !== 'boolean' || typeof x.seen.finale !== 'boolean'
    || x.pendingRepairs !== undefined && !nonnegative(x.pendingRepairs) || !Array.isArray(x.routes) || !x.routes.every((i) => typeof i === 'string' && Object.hasOwn(ISLANDS, i))
    || new Set(x.routes).size !== x.routes.length || !Array.isArray(x.businesses) || !Array.isArray(x.loans) || !obj(x.log)) return false;
  const owners = [...players, 'mainland'];
  if (!x.businesses.every((b) => obj(b) && business(b.id) && typeof b.damaged === 'boolean' && week(b.builtWeek)
    && (['owner', 'hired', 'partner'].includes(String(b.manager)) || obj(b.manager) && players.includes(String(b.manager.neighborId)))
    && Array.isArray(b.stakes) && b.stakes.length > 0 && b.stakes.every((s) => obj(s) && owners.includes(String(s.playerId)) && num(s.share) && s.share > 0 && s.share <= 1)
    && b.stakes.reduce((n, s) => n + Number(s.share), 0) === 1
    && new Set(b.stakes.map((s) => s.playerId)).size === b.stakes.length)) return false;
  if (new Set(x.businesses.map((b) => (b as Obj).id)).size !== x.businesses.length) return false;
  if (!x.loans.every((l) => obj(l) && typeof l.uid === 'string' && (l.borrower === 'npc' || players.includes(String(l.borrower)))
    && cls(l.cls) && nonnegative(l.principal) && nonnegative(l.weeklyRate) && week(l.startWeek) && week(l.dueWeek) && week(l.tries)
    && typeof l.crisisSeen === 'boolean')) return false;
  const log = x.log;
  return ['decisionWeeks', 'homeDecisionWeeks'].every((key) => Array.isArray(log[key]) && (log[key] as unknown[]).every(week))
    && ['paidToNeighbors', 'bankLent', 'bankDefaulted', 'bankInterest', 'repairs'].every((key) => nonnegative(log[key]))
    && num(log.businessIncome);
}
