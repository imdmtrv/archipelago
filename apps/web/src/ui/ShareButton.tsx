import { useState } from 'react';
import { useI18n } from '../i18n';
import { share } from '../share';

export function ShareButton({ challenge = false, className = 'btn ghost share-result' }: { challenge?: boolean; className?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return <button className={className} type="button" disabled={busy} aria-busy={busy} onClick={async () => {
    setBusy(true);
    try { await share(); } finally { setBusy(false); }
  }}>{challenge ? t.ui.challenge.button : t.ui.share.button}</button>;
}
