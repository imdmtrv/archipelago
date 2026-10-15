import { getPlayer, type ProfessionId } from '@arch/engine';
import { HUMAN, useGame } from './store';

export type AnalyticsEvent =
  | `profession-${ProfessionId}`
  | 'game-start' | 'week-5' | 'week-10' | 'week-20'
  | 'freedom' | 'dream-done' | 'share' | 'feedback-open'
  | 'coach-done' | 'coach-skip' | 'lang-switch' | 'challenge-open' | 'challenge-start'
  | 'no-webgl' | 'scene-error' | 'js-error';

declare global {
  interface Window {
    goatcounter?: { count: (args: { path: string; title?: string; event: true }) => void };
  }
}

const endpoint = import.meta.env.VITE_GOATCOUNTER_URL?.trim();
const queue: { event: AnalyticsEvent; title?: string }[] = [];
let initialized = false;
const jsErrors = new Set<string>();

/** В диагностике нет имён игрока, острова и значений полей. */
export function errorTitle(title: string): string {
  const { world, challenge, shareFallback } = useGame.getState();
  const privateValues = [challenge?.name, challenge?.island, shareFallback?.identity.name];
  for (const player of world?.players ?? []) {
    if (!player.isBot) privateValues.push(player.name, player.islandName);
  }
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], input:not([type]), textarea')) {
    privateValues.push(input.value);
  }
  try {
    const identity = JSON.parse(localStorage.getItem('archipelago.share.identity.v1') ?? 'null');
    if (typeof identity?.name === 'string') privateValues.push(identity.name);
  } catch { /* хранилище недоступно */ }
  for (const value of privateValues.filter((v): v is string => !!v).sort((a, b) => b.length - a.length)) {
    title = title.split(value).join('\u0000');
  }
  // Ссылки могут содержать приглашение с именем и названием острова.
  return title.replace(/https?:\/\/[^\s"'<>]+/g, (url) => fileName(url)).replace(/\u0000/g, '[redacted]').slice(0, 120);
}

function fileName(path: string): string {
  return path.split(/[?#]/)[0].split(/[\\/]/).pop() || 'unknown';
}

function reportJsError(message: string, filename = '', line = 0) {
  const title = errorTitle(`${message} · ${fileName(filename)}:${line}`);
  if (jsErrors.size >= 3 || jsErrors.has(title)) return;
  jsErrors.add(title);
  track('js-error', title);
}

export function track(event: AnalyticsEvent, title?: string) {
  if (!endpoint) return;
  const counter = window.goatcounter;
  if (!counter) { queue.push({ event, title }); return; }
  counter.count({ path: event, title, event: true });
}

function flush() {
  if (!window.goatcounter) return;
  for (const item of queue.splice(0)) track(item.event, item.title);
}

export function initAnalytics() {
  if (initialized) return;
  const params = new URLSearchParams(location.search);
  if (params.has('sound') || params.has('sandbox') || params.has('director')) return;
  initialized = true;
  window.addEventListener('error', (event) => {
    if (event.message) reportJsError(event.message, event.filename, event.lineno);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled rejection';
    const source = reason instanceof Error ? reason.stack?.match(/(?:https?:\/\/|file:\/\/|\/)[^\s)]+:(\d+):\d+/) : null;
    reportJsError(message, source?.[0].replace(/:\d+:\d+$/, ''), Number(source?.[1] ?? 0));
  });
  if (endpoint) {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.goatcounter = endpoint;
    script.src = '//gc.zgo.at/count.js';
    script.addEventListener('load', flush);
    document.head.append(script);
  }

  useGame.subscribe((state, previous) => {
    const world = state.world, before = previous.world;
    if (!world) return;
    if (!before) track('game-start');
    if (before) {
      for (const week of [5, 10, 20] as const) {
        if (before.week < week && world.week >= week) track(`week-${week}` as AnalyticsEvent);
      }
      const me = getPlayer(world, HUMAN), prior = getPlayer(before, HUMAN);
      if (prior.freedomWeek === null && me.freedomWeek !== null) track('freedom', String(me.freedomWeek));
      if (prior.dream?.doneWeek === null && me.dream?.doneWeek !== null) track('dream-done');
    }
  });
}
