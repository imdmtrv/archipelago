import { getPlayer } from '@arch/engine';
import { track } from './analytics';
import { HUMAN, useGame } from './store';
import { challengeComparison, challengeResult, displayPlayer, getI18n, weeksAcc } from './i18n';
import { encodeChallenge, MAX_CHALLENGE_WEEKS, type ChallengeData } from './challenge';
import { createShareCard } from './shareCard';

/** Только завершённые недели: текущие покупки попадут в запись после итогов недели. */
export function currentChallenge(): ChallengeData | null {
  const { world, history, moments } = useGame.getState();
  const week = world?.lastReport?.week ?? 0;
  if (!world || week < 1 || week > MAX_CHALLENGE_WEEKS) return null;
  const me = getPlayer(world, HUMAN), shown = displayPlayer(me);
  const points = new Map((history[HUMAN] ?? []).map((p) => [p.week, p.ratio]));
  return { v: 1, seed: world.seed, profession: me.profession, name: shown.name, island: shown.islandName, week, freedomWeek: me.freedomWeek,
    progress: Array.from({ length: week }, (_, i) => Math.max(0, Math.min(99999, Math.round((points.get(i + 1) ?? 0) * 100)))),
    moments: moments.filter((m) => m.week <= week) };
}

let sharing = false;
export async function share() {
  if (sharing) return;
  sharing = true;
  const { lang, t } = getI18n();
  try {
    const data = currentChallenge();
    if (!data) throw new Error('No recorded weeks');
    const siteUrl = import.meta.env.VITE_SITE_URL || location.origin + import.meta.env.BASE_URL;
    const base = new URL(siteUrl, location.href);
    base.search = ''; base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const url = new URL(lang === 'en' ? 'en/' : '', base);
    url.searchParams.set('c', encodeChallenge(data));
    const challenge = useGame.getState().challenge;
    let message = data.freedomWeek === null ? challengeResult(data) : t.ui.challenge.message(weeksAcc(data.freedomWeek), data.island);
    if (challenge && data.freedomWeek !== null) message += `\n${challengeComparison(data.freedomWeek, challenge, true)}.`;
    const blob = await createShareCard(data, challenge, base.host + base.pathname);
    const file = new File([blob], 'archipelago-challenge.png', { type: 'image/png' });
    try {
      if (matchMedia('(pointer: coarse)').matches && navigator.share && navigator.canShare?.({ files: [file] })) {
        track('share');
        await navigator.share({ files: [file], title: t.ui.share.title, text: message, url: url.href });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // При ошибке системного меню все способы отправки доступны в своём окне.
    }
    useGame.setState({ shareFallback: { blob, message, url: url.href } });
    track('share');
  } catch {
    useGame.getState().showToast(t.ui.share.failed, 'bad');
  } finally { sharing = false; }
}
