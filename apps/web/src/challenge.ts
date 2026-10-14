import { ASSET_DEFS, DREAMS, FREEDOM_LEVEL_RATIOS, PROFESSION_ORDER, type ProfessionId } from '@arch/engine';

export type MomentKind = 'bought' | 'upgraded' | 'freedom' | 'freedomLevel' | 'dreamStage' | 'dreamDone';
export interface Moment { week: number; kind: MomentKind; defId?: string; level?: number }
export interface ChallengeData {
  v: 1 | 2;
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
  return (value.v === 1 || value.v === 2) && integer(value.seed, 0, 2 ** 32 - 1)
    && label(value.name, value.v === 1 ? 20 : 24) && label(value.island, value.v === 1 ? 24 : 32)
    && (value.profession === undefined || PROFESSION_ORDER.some((id) => id === value.profession))
    && integer(value.week, 1, MAX_CHALLENGE_WEEKS)
    && (value.freedomWeek === null || integer(value.freedomWeek, 1, value.week))
    && Array.isArray(value.progress) && value.progress.length === value.week
    && value.progress.every((p) => integer(p, 0, 99999)) && validMoments(value.moments, value.week);
}

const assetIds = Object.keys(ASSET_DEFS);
const momentKinds: MomentKind[] = ['bought', 'upgraded', 'freedom', 'freedomLevel', 'dreamStage', 'dreamDone'];
const base64url = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Сначала свобода, затем первые покупки и улучшения каждого актива по времени. */
function shortMoments(moments: Moment[]): Moment[] {
  const seen = new Set<string>();
  const first = moments.filter((m) => {
    if (m.kind !== 'bought' && m.kind !== 'upgraded') return false;
    const key = `${m.kind}:${m.defId}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const freedom = moments.find((m) => m.kind === 'freedom');
  return [...(freedom ? [freedom] : []), ...first].slice(0, 8).sort((a, b) => a.week - b.week);
}

/** Не разрезаем многобайтовый символ UTF-8 на границе короткого имени. */
function shortLabel(value: string, max: number): Uint8Array {
  const encoder = new TextEncoder();
  let result = '';
  for (const char of value) {
    if (encoder.encode(result + char).length > max) break;
    result += char;
  }
  return encoder.encode(result.trimEnd());
}

export function encodeChallenge(data: ChallengePayload): string {
  if (!validChallenge(data)) throw new Error('Invalid challenge');
  if (data.v === 1) {
    const code = base64url(new TextEncoder().encode(JSON.stringify(data)));
    if (code.length > MAX_CODE_LENGTH) throw new Error('Challenge too long');
    return code;
  }
  const name = shortLabel(data.name, 24), island = shortLabel(data.island, 32), moments = shortMoments(data.moments);
  // Заголовок — 10 байт: версия, seed; профессия (2 бита), недели (по 11), число моментов (4), длины строк (5 и 6).
  const bytes = new Uint8Array(10 + Math.ceil(data.week / 2) + moments.length * 4 + name.length + island.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 2; view.setUint32(1, data.seed);
  view.setUint32(5, PROFESSION_ORDER.indexOf(data.profession ?? 'teacher') | (data.week << 2)
    | ((data.freedomWeek ?? 0) << 13) | (moments.length << 24) | ((name.length & 15) << 28));
  bytes[9] = (name.length >> 4) | (island.length << 1);
  let offset = 10;
  for (let i = 0; i < data.week; i += 2) bytes[offset++] = Math.min(255, Math.round(data.progress[i] / 4));
  for (const m of moments) {
    view.setUint16(offset, m.week);
    bytes[offset + 2] = momentKinds.indexOf(m.kind) | ((m.level ?? 0) << 3);
    bytes[offset + 3] = m.defId ? assetIds.indexOf(m.defId) : 0;
    offset += 4;
  }
  bytes.set(name, offset); offset += name.length; bytes.set(island, offset);
  const code = base64url(bytes);
  if (code.length > MAX_CODE_LENGTH) throw new Error('Challenge too long');
  return code;
}

export function decodeChallenge(code: string): ChallengeData | null {
  try {
    if (!code || code.length > MAX_CODE_LENGTH || code.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
    const raw = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - code.length % 4) % 4));
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    if (base64url(bytes) !== code) return null;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    if (bytes[0] !== 2) {
      const data: unknown = JSON.parse(decoder.decode(bytes));
      return validChallenge(data) && data.v === 1 && encodeChallenge(data) === code ? { ...data, profession: data.profession ?? 'teacher' } : null;
    }
    if (bytes.length < 12) return null;
    const view = new DataView(bytes.buffer), packed = view.getUint32(5);
    const week = (packed >>> 2) & 2047, freedomWeek = (packed >>> 13) & 2047;
    const profession = PROFESSION_ORDER[packed & 3], count = (packed >>> 24) & 15;
    const nameLength = (packed >>> 28) | ((bytes[9] & 1) << 4), islandLength = bytes[9] >>> 1;
    if (!profession || !integer(week, 1, MAX_CHALLENGE_WEEKS) || freedomWeek > week || count > 8
      || !integer(nameLength, 1, 24) || !integer(islandLength, 1, 32)) return null;
    let offset = 10;
    const samples = bytes.slice(offset, offset + Math.ceil(week / 2)); offset += samples.length;
    if (samples.length !== Math.ceil(week / 2) || offset + count * 4 + nameLength + islandLength !== bytes.length) return null;
    const progress = Array.from({ length: week }, (_, i) => {
      const left = samples[Math.floor(i / 2)] * 4;
      return i % 2 === 0 ? left : (left + (samples[Math.floor(i / 2) + 1] ?? samples[Math.floor(i / 2)]) * 4) / 2;
    });
    const moments: Moment[] = [];
    for (let i = 0; i < count; i++) {
      const kind = momentKinds[bytes[offset + 2] & 7], level = bytes[offset + 2] >> 3, asset = bytes[offset + 3];
      if (!kind || (kind !== 'bought' && kind !== 'upgraded' && asset !== 0)) return null;
      const m: Moment = { week: view.getUint16(offset), kind };
      if (kind === 'bought' || kind === 'upgraded') { if (!assetIds[asset]) return null; m.defId = assetIds[asset]; }
      if (level) m.level = level;
      moments.push(m); offset += 4;
    }
    const readLabel = (length: number) => {
      const value = decoder.decode(bytes.slice(offset, offset + length)); offset += length;
      return value;
    };
    const name = readLabel(nameLength), island = readLabel(islandLength);
    const data: ChallengeData = { v: 2, seed: view.getUint32(1), profession, week, freedomWeek: freedomWeek || null, progress, moments, name, island };
    return offset === bytes.length && validChallenge(data) ? data : null;
  } catch { return null; }
}

export function ghostProgress(data: ChallengeData, week: number): number {
  return data.progress[Math.max(0, Math.min(data.week, week) - 1)] ?? 0;
}
