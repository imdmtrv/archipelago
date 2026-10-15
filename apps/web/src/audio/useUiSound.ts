import { useEffect } from 'react';
import { audio } from './engine';
import { CUES, type CueId } from './cues';

/** Общие слушатели для мыши, касаний и клавиатуры. */
export function useUiSound() {
  useEffect(() => {
    const unlock = (event: Event) => { if (event.isTrusted) audio.unlock(); };
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('button, a[href]');
      if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
      const cue = button.dataset.uiSound;
      if (cue === 'none' || button.matches('.nb-chip.me')) return;
      if (cue && cue in CUES) audio.play(cue as CueId);
      else if (button.matches('.nb-chip:not(.active)')) audio.play('ui.open');
      else audio.play('ui.click');
    };
    const change = (event: Event) => {
      if (event.isTrusted && event.target instanceof HTMLInputElement && event.target.type === 'checkbox'
        && event.target.dataset.uiSound !== 'none') audio.play('ui.toggle');
    };
    const gestures = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    gestures.forEach((type) => document.addEventListener(type, unlock, true));
    document.addEventListener('click', click, true);
    document.addEventListener('change', change, true);
    return () => {
      gestures.forEach((type) => document.removeEventListener(type, unlock, true));
      document.removeEventListener('click', click, true);
      document.removeEventListener('change', change, true);
    };
  }, []);
}
