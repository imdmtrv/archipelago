import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import { getI18n, useI18n } from '../i18n';

/** Картинка и сообщение доступны для отправки и ручного копирования до закрытия окна. */
export function ShareDialog() {
  const { t } = useI18n();
  const data = useGame((s) => s.shareFallback);
  const dialog = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = (text: string, tone: 'good' | 'bad' = 'good') => useGame.getState().showToast(text, tone);
  const close = () => {
    useGame.setState({ shareFallback: null });
    toast(getI18n().t.ui.challenge.close);
  };
  useEffect(() => {
    if (!data) return;
    const objectUrl = URL.createObjectURL(data.blob);
    setPreview(objectUrl);
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); close();
      } else if (e.key === 'Enter') {
        // Enter в поле или на ссылке не закрывает лежащее под ним окно итогов.
        e.stopImmediatePropagation();
      } else if (e.key === 'Tab') {
        e.stopImmediatePropagation();
        const controls = dialog.current?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled), a[href]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      URL.revokeObjectURL(objectUrl);
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [data]);
  if (!data) return null;
  const content = `${data.message}\n${data.url}`;
  const copy = async (image: boolean) => {
    setBusy(true);
    try {
      if (image) await navigator.clipboard.write([new ClipboardItem({ 'image/png': data.blob })]);
      else await navigator.clipboard.writeText(content);
      toast(image ? t.ui.challenge.imageCopied : t.ui.challenge.linkCopied);
    } catch { toast(t.ui.challenge.copyFailed, 'bad'); }
    finally { setBusy(false); }
  };
  const download = () => {
    try {
      const link = document.createElement('a');
      link.href = preview; link.download = 'archipelago-challenge.png';
      document.body.append(link); link.click(); link.remove();
      toast(t.ui.challenge.download);
    } catch { toast(t.ui.share.failed, 'bad'); }
  };
  const social = [
    { label: t.ui.challenge.sendTelegram, href: `https://t.me/share/url?url=${encodeURIComponent(data.url)}&text=${encodeURIComponent(data.message)}` },
    { label: t.ui.challenge.sendVk, href: `https://vk.com/share.php?url=${encodeURIComponent(data.url)}&title=${encodeURIComponent(data.message)}` },
    { label: t.ui.challenge.sendWhatsApp, href: `https://wa.me/?text=${encodeURIComponent(content)}` },
  ];
  return <div className="modal-backdrop share-backdrop" onClick={close}>
    <div ref={dialog} className="modal panel share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" aria-describedby="share-lead" onClick={(e) => e.stopPropagation()}>
      <h2 id="share-title">{t.ui.challenge.dialogTitle}</h2>
      <p id="share-lead" className="lead">{t.ui.challenge.dialogLead}</p>
      <div className="share-body">
        {preview && <img className="share-preview" src={preview} alt={t.ui.challenge.dialogTitle} />}
        <div className="share-controls">
          <textarea className="challenge-link" readOnly value={content} aria-label={t.ui.challenge.copyLink} onFocus={(e) => e.target.select()} />
          <button className="btn primary" type="button" disabled={busy} onClick={() => void copy(true)}>{t.ui.challenge.copyImage}</button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void copy(false)}>{t.ui.challenge.copyLink}</button>
          <button className="btn ghost" type="button" disabled={!preview} onClick={download}>{t.ui.challenge.download}</button>
          <div className="share-social">{social.map(({ label, href }) => <a key={href} className="btn ghost" href={href} target="_blank" rel="noreferrer" onClick={() => toast(label)}>{label}</a>)}</div>
        </div>
      </div>
      <button className="btn ghost" type="button" onClick={close}>{t.ui.challenge.close}</button>
    </div>
  </div>;
}
