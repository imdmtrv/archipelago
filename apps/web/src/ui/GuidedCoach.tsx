import { useEffect, useRef, useState } from 'react';
import { useCoach } from './coach';
import { useI18n } from '../i18n';

interface Placement { step: number; targetUid: string | null; target: DOMRect; bubbleTop: number; bubbleLeft: number; above: boolean; measured: boolean }

// Окна со своим состоянием (например, отзыв) тоже скрывают обучение.
const blocked = () => window.matchMedia('(max-width: 1023px)').matches
  && !!document.querySelector('.modal-backdrop, .neighbor-card, .feedback-prompt, .audio-panel');

export function Coach() {
  const { t } = useI18n();
  const step = useCoach((s) => s.step);
  const targetUid = useCoach((s) => s.targetUid);
  const skip = useCoach((s) => s.skip);
  const finish = useCoach((s) => s.finish);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlacement(null);
    if (!step) return;
    let frame = 0;
    const update = () => {
      if (blocked()) {
        setPlacement(null);
        frame = requestAnimationFrame(update);
        return;
      }
      const selector = step === 1 && targetUid
        ? `[data-offer-uid="${targetUid}"] .btn.primary`
        : step === 2 ? '[data-coach="next-week"]:not([hidden])' : '[data-coach="freedom"]';
      const candidates = [...document.querySelectorAll<HTMLElement>(selector)];
      let target = candidates.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
      });
      if (!target && candidates[0]) {
        candidates[0].scrollIntoView({ block: 'center', inline: 'nearest' });
        target = candidates[0];
      }
      if (!target) setPlacement(null);
      else {
        const rect = target.getBoundingClientRect();
        const width = Math.min(300, innerWidth - 24);
        const bubbleHeight = bubbleRef.current?.getBoundingClientRect().height ?? 0;
        const measured = bubbleHeight > 0;
        const aboveTop = rect.top - 6 - 10 - bubbleHeight;
        const belowTop = rect.bottom + 6 + 10;
        const above = measured && aboveTop >= 12;
        const bubbleTop = above
          ? aboveTop
          : Math.max(12, Math.min(innerHeight - bubbleHeight - 12, belowTop));
        const bubbleLeft = Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
        setPlacement({ step, targetUid, target: rect, bubbleTop, bubbleLeft, above, measured });
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [step, targetUid]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !blocked()) skip(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step, skip]);

  if (!step) return null;
  // При смене шага прежняя геометрия не применяется к новому тексту даже на один кадр.
  const active = placement?.step === step && placement.targetUid === targetUid && placement.measured ? placement : null;
  const r = active?.target;
  return (
    <div className="coach" role="dialog" aria-live="polite">
      {r && <div className="coach-ring" style={{ left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12, borderRadius: 18 }} />}
      <div
        ref={bubbleRef}
        className={`coach-bubble ${active?.above ? 'above' : 'below'}`}
        style={{ left: active?.bubbleLeft ?? 12, top: active?.bubbleTop ?? 12, visibility: active ? 'visible' : 'hidden' }}
      >
        <div className="coach-kicker">{t.ui.coach.kicker(step)}</div>
        <p>{t.ui.coach.steps[step - 1]}</p>
        {step === 3
          ? <button className="btn primary" type="button" onClick={finish}>{t.ui.coach.done}</button>
          : <button className="coach-skip" type="button" onClick={skip}>{t.ui.coach.skip}</button>}
      </div>
    </div>
  );
}
