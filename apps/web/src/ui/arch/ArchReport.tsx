import type { ArchWeekLines } from '@arch/engine';
import { useI18n } from '../../i18n';

export function ArchReport({ lines }: { lines: ArchWeekLines | null }) {
  const { t, signed } = useI18n();
  if (!lines) return null;
  const entries = [
    ['businesses', lines.businesses], ['routes', lines.routes], ['bankInterest', lines.bankInterest],
    ['managers', -lines.managers], ['bankLost', -lines.bankLost], ['upkeep', -lines.upkeep],
    ['insurance', -lines.insurance], ['repairs', -lines.repairs],
  ] as const;
  return <div className="arch-report"><h4>{t.arch.report.title}</h4>{entries.map(([id, amount]) => <div className="row" key={id}>
    <span>{t.arch.report[id]}</span><b className={amount < 0 ? 'neg' : amount > 0 ? 'pos' : ''}>{signed(amount)}</b>
  </div>)}</div>;
}
