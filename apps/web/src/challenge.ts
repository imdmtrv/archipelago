import { ASSET_DEFS, DREAMS, FREEDOM_LEVEL_RATIOS, PROFESSION_ORDER, type ProfessionId } from '@arch/engine';

export type MomentKind = 'bought' | 'upgraded' | 'freedom' | 'freedomLevel' | 'dreamStage' | 'dreamDone';
export interface Moment { week: number; kind: MomentKind; defId?: string; level?: number }
export interface ChallengeData {
  v: 1;
  seed: number;
  profession: ProfessionId;
  name: string;
  island: string;
  week: number;
  freedomWeek: number | null;
  progress: number[];
  moments: Moment[];
}

export const GHOST_ID = 'challenge-ghost';
export const MAX_CHALLENGE_WEEKS = 2000;
const MAX_CODE_LENGTH = 24000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const label = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);

/** В ссылке нет произвольных событий или названий активов — только известные идентификаторы. */
export function validMoments(value: unknown, week = MAX_CHALLENGE_WEEKS): value is Moment[] {
  return Array.isArray(value) && value.length <= 20 && value.every((m, i) => {
    if (!object(m) || !keys(m, ['week', 'kind', 'defId', 'level']) || !integer(m.week, 1, week)) return false;
    if (i > 0 && value[i - 1].week > m.week) return false;
    switch (m.kind) {
      case 'bought': case 'upgraded': {
        if (typeof m.defId !== 'string' || !Object.hasOwn(ASSET_DEFS, m.defId)) return false;
        return m.kind === 'bought' ? m.level === undefined : integer(m.level, 2, 1 + (ASSET_DEFS[m.defId].upgrades?.length ?? 0));
      }
      case 'freedom': case 'dreamDone': return m.defId === undefined && m.level === undefined;
      case 'freedomLevel': return m.defId === undefined && integer(m.level, 2, FREEDOM_LEVEL_RATIOS.length);
      case 'dreamStage': return m.defId === undefined && integer(m.level, 1, DREAMS.schooner.stages.length);
      default: return false;
    }
  });
}

type ChallengePayload = Omit<ChallengeData, 'profession'> & { profession?: ProfessionId };

export function validChallenge(value: unknown): value is ChallengePayload {
  if (!object(value) || !keys(value, ['v', 'seed', 'profession', 'name', 'island', 'week', 'freedomWeek', 'progress', 'moments'])) return false;
  return value.v === 1 && integer(value.seed, 0, 2 ** 32 - 1) && label(value.name, 20) && label(value.island, 24)
    && (value.profession === undefined || PROFESSION_ORDER.some((id) => id === value.profession))
    && integer(value.week, 1, MAX_CHALLENGE_WEEKS)
    && (value.freedomWeek === null || integer(value.freedomWeek, 1, value.week))
    && Array.isArray(value.progress) && value.progress.length === value.week
    && value.progress.every((p) => integer(p, 0, 99999)) && validMoments(value.moments, value.week);
}

export function encodeChallenge(data: ChallengePayload): string {
  if (!validChallenge(data)) throw new Error('Invalid challenge');
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const code = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (code.length > MAX_CODE_LENGTH) throw new Error('Challenge too long');
  return code;
}

export function decodeChallenge(code: string): ChallengeData | null {
  try {
    if (!code || code.length > MAX_CODE_LENGTH || code.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
    const raw = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - code.length % 4) % 4));
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
    return validChallenge(data) && encodeChallenge(data) === code ? { ...data, profession: data.profession ?? 'teacher' } : null;
  } catch { return null; }
}

export function ghostProgress(data: ChallengeData, week: number): number {
  return data.progress[Math.max(0, Math.min(data.week, week) - 1)] ?? 0;
}
