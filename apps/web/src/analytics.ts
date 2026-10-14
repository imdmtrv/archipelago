import { getPlayer, type ProfessionId } from '@arch/engine';
import { HUMAN, useGame } from './store';

export type AnalyticsEvent =
  | `profession-${ProfessionId}`
  | 'game-start' | 'week-5' | 'week-10' | 'week-20'
  | 'freedom' | 'dream-done' | 'share' | 'feedback-open'
  | 'coach-done' | 'coach-skip' | 'lang-switch' | 'challenge-open' | 'challenge-start';

declare global {
  interface Window {
    goatcounter?: { count: (args: { path: string; title?: string; event: true }) => void };
  }
}

const endpoint = import.meta.env.VITE_GOATCOUNTER_URL?.trim();
const queue: { event: AnalyticsEvent; title?: string }[] = [];
let initialized = false;

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
