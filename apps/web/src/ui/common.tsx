import { useEffect, useRef, useState, type ReactNode } from 'react';
import { percent } from './text';
import { useI18n } from '../i18n';

/** «Свобода: 92% → 99%» — что покупка или улучшение сделает со шкалой свободы. */
export function FreedomLine({ before, after }: { before: number; after: number }) {
  const { t } = useI18n();
  const a = percent(before), b = percent(after);
  const tone = b > a ? 'pos' : b < a ? 'neg' : '';
  return <div className={`freedom-line ${tone}`}>{t.levels[0]}: {a}% → {b}%</div>;
}

export function Coin({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return <span className={`coin ${size === 'sm' ? 'sm' : ''}`} aria-hidden />;
}

export function Meter({ value, max = 100, tone }: { value: number; max?: number; tone?: 'good' | 'warn' | 'bad' }) {
  const t = tone ?? (value / max > 0.5 ? 'good' : value / max > 0.25 ? 'warn' : 'bad');
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={`meter-fill ${t}`} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

export function Pips({ value, max }: { value: number; max: number }) {
  return (
    <span className="pips" aria-label={`${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={i < value ? 'on' : ''} />)}
    </span>
  );
}

/** Кнопка с подтверждением вторым нажатием — для необратимых действий вроде продажи. */
export function ConfirmButton({ children, confirmText, onConfirm, className = 'btn ghost sm', disabled }: {
  children: ReactNode; confirmText: ReactNode; onConfirm: () => void; className?: string; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      className={`${className} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) { setArmed(false); onConfirm(); return; }
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), 3000);
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h4>{title}</h4>{aside}</div>
      {children}
    </section>
  );
}

/** Праздничное конфетти: свобода и эпилог. */
export function Confetti() {
  const [pieces] = useState(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    color: ['#F5B83D', '#E8735A', '#3E9A9A', '#23935E', '#FFF4E2'][i % 5],
    dx: Math.random() * 200 - 100,
    rot: Math.random() * 900 - 450,
    dur: 2.2 + Math.random() * 1.8,
    delay: Math.random() * 0.6,
  })));
  return (
    <>
      {pieces.map((p, i) => (
        <div
          key={i}
          className="confetti"
          style={{
            left: `${p.left}vw`, background: p.color, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`,
            ['--dx' as string]: `${p.dx}px`, ['--rot' as string]: `${p.rot}deg`,
          }}
        />
      ))}
    </>
  );
}

/** Фокус без прокрутки: кнопка внизу высокого окна не уводит заголовок за край экрана (вместо autoFocus). */
export const focusOnMount = (el: HTMLElement | null) => el?.focus({ preventScroll: true });
