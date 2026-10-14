import { getPlayer } from '@arch/engine';
import { track } from './analytics';
import { HUMAN, useGame } from './store';
import { challengeComparison, challengeResult, displayPlayer, getI18n, weeksAcc } from './i18n';
import { encodeChallenge, MAX_CHALLENGE_WEEKS, type ChallengeData } from './challenge';
import { createShareCard } from './shareCard';

export type ShareGender = 'male' | 'female' | 'neutral';
export interface ShareIdentity { name: string; gender: ShareGender }
export interface SharePayload {
  blob: Blob; message: string; url: string; site: string;
  source: ChallengeData; challenge: ChallengeData | null; identity: ShareIdentity;
}
const IDENTITY_KEY = 'archipelago.share.identity.v1';

export function readShareIdentity(playerName: string): ShareIdentity {
  const fallback: ShareIdentity = { name: playerName === getI18n().t.meta.defaultPlayer || playerName === 'Вы' || playerName === 'You' ? '' : playerName, gender: 'neutral' };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && 'name' in saved && typeof saved.name === 'string'
      && 'gender' in saved && (saved.gender === 'male' || saved.gender === 'female' || saved.gender === 'neutral')) {
      return { name: saved.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 20), gender: saved.gender };
    }
  } catch { /* хранилище недоступно — используем имя игрока */ }
  return fallback;
}

export function saveShareIdentity(identity: ShareIdentity) {
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); }
  catch { /* окно работает и без сохранения */ }
}

export function shareContent(source: ChallengeData, challenge: ChallengeData | null, identity: ShareIdentity) {
  const { lang, t } = getI18n();
  const data = { ...source, v: 2 as const, name: identity.name.trim() || t.ui.challenge.friendName };
  const base = new URL(import.meta.env.VITE_SITE_URL || location.origin + import.meta.env.BASE_URL, location.href);
  base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(lang === 'en' ? 'en/' : '', base);
  url.searchParams.set('c', encodeChallenge(data));
  const gender = lang === 'ru' ? identity.gender : 'neutral';
  let message = data.freedomWeek === null ? challengeResult(data) : t.ui.challenge.message[gender](weeksAcc(data.freedomWeek));
  if (challenge && data.freedomWeek !== null) message += `\n${challengeComparison(data.freedomWeek, challenge, true)}.`;
  return { data, message, url: url.href, site: base.host + base.pathname };
}

export async function prepareShare(source: ChallengeData, challenge: ChallengeData | null, identity: ShareIdentity): Promise<SharePayload> {
  const content = shareContent(source, challenge, identity);
  const blob = await createShareCard(content.data, challenge, content.site, identity);
  return { ...content, blob, source, challenge, identity };
}

/** Только завершённые недели: текущие покупки попадут в запись после итогов недели. */
export function currentChallenge(): ChallengeData | null {
  const { world, history, moments } = useGame.getState();
  const week = world?.lastReport?.week ?? 0;
  if (!world || week < 1 || week > MAX_CHALLENGE_WEEKS) return null;
  const me = getPlayer(world, HUMAN), shown = displayPlayer(me);
  const points = new Map((history[HUMAN] ?? []).map((p) => [p.week, p.ratio]));
  return { v: 2, seed: world.seed, profession: me.profession, name: shown.name, island: shown.islandName, week, freedomWeek: me.freedomWeek,
    progress: Array.from({ length: week }, (_, i) => Math.max(0, Math.min(99999, Math.round((points.get(i + 1) ?? 0) * 100)))),
    moments: moments.filter((m) => m.week <= week) };
}

let sharing = false;
export async function share() {
  if (sharing) return;
  sharing = true;
  const { t } = getI18n();
  try {
    const data = currentChallenge();
    if (!data) throw new Error('No recorded weeks');
    const challenge = useGame.getState().challenge;
    const payload = await prepareShare(data, challenge, readShareIdentity(data.name));
    const file = new File([payload.blob], 'archipelago-challenge.png', { type: 'image/png' });
    try {
      if (matchMedia('(pointer: coarse)').matches && navigator.share && navigator.canShare?.({ files: [file] })) {
        track('share');
        await navigator.share({ files: [file], title: t.ui.share.title, text: `${payload.message}\n${t.ui.challenge.linkWord}`, url: payload.url });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // При ошибке системного меню все способы отправки доступны в своём окне.
    }
    useGame.setState({ shareFallback: payload });
    track('share');
  } catch {
    useGame.getState().showToast(t.ui.share.failed, 'bad');
  } finally { sharing = false; }
}
