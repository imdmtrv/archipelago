// Мягкое приглашение оставить отзыв: после 10-й недели, а если игрок ответил «Позже» — ещё раз после 30-й.
// Показывается, только если сборка знает ссылку на форму (VITE_FEEDBACK_URL), и никогда поверх окон.
import { useState } from 'react';
import { useGame } from '../store';
import { useI18n } from '../i18n';
import { track } from '../analytics';

const KEY = 'archipelago.feedback.v1';
const FIRST_WEEK = 10;
const SECOND_WEEK = 30;
const feedbackUrl = import.meta.env.VITE_FEEDBACK_URL?.trim();

/** null — ещё не спрашивали; 'later' — спросить ещё раз; 'done' — больше не спрашивать. */
function stored(): string | null {
  try { return localStorage.getItem(KEY); } catch { return 'done'; }
}
function remember(value: 'later' | 'done') {
  try { localStorage.setItem(KEY, value); } catch { /* storage unavailable */ }
}

export function FeedbackPrompt() {
  const { t } = useI18n();
  const week = useGame((s) => s.world?.week ?? 0);
  const blocked = useGame((s) => s.busy || !!s.modal || s.choiceOpen || !!s.archNotice);
  const [state, setState] = useState(stored);
  const due = state === null ? week > FIRST_WEEK : state === 'later' && week > SECOND_WEEK;
  if (!feedbackUrl || !due || blocked) return null;

  const close = (value: 'later' | 'done') => { remember(value); setState(value); };
  return (
    <div className="feedback-prompt panel" role="dialog" aria-label={t.ui.feedbackPrompt.title}>
      <b>{t.ui.feedbackPrompt.title}</b>
      <p>{t.ui.feedbackPrompt.text}</p>
      <div className="feedback-prompt-buttons">
        <a
          className="btn primary" href={feedbackUrl} target="_blank" rel="noreferrer"
          onClick={() => { track('feedback-open'); close('done'); }}
        >
          {t.ui.feedbackPrompt.open}
        </a>
        <button className="btn ghost" type="button" onClick={() => close(state === 'later' ? 'done' : 'later')}>
          {t.ui.feedbackPrompt.later}
        </button>
      </div>
    </div>
  );
}
