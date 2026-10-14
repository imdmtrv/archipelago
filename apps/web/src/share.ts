import { getPlayer } from '@arch/engine';
import { track } from './analytics';
import { HUMAN, useGame } from './store';
import { challengeResult, displayPlayer, getI18n } from './i18n';
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
export async function share(text?: string) {
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
    const message = text ?? challengeResult(data);
    const blob = await createShareCard(data, useGame.getState().challenge, base.host + base.pathname);
    const file = new File([blob], 'archipelago-challenge.png', { type: 'image/png' });
    track('share');
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: t.ui.share.title, text: message, url: url.href });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        // Неподдерживаемая отправка файлов — обычное скачивание и ссылка.
      }
    }
    const download = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    download.href = objectUrl; download.download = file.name;
    document.body.append(download); download.click(); download.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    const content = `${message}\n${url.href}`;
    try {
      await navigator.clipboard.writeText(content);
      useGame.getState().showToast(t.ui.challenge.downloaded, 'good');
    } catch {
      // Старые браузеры и HTTP: копирование в рамках нажатия на кнопку.
      const input = document.createElement('textarea');
      input.value = content; input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.append(input); input.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* покажем ссылку вручную */ }
      input.remove();
      if (copied) useGame.getState().showToast(t.ui.challenge.downloaded, 'good');
      else useGame.setState({ shareFallback: content });
    }
  } catch {
    useGame.getState().showToast(t.ui.share.failed, 'bad');
  } finally { sharing = false; }
}
