import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import { getI18n, useI18n } from '../i18n';
import { prepareShare, saveShareIdentity, shareContent, type ShareIdentity, type SharePayload } from '../share';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Картинка и сообщение доступны для отправки и ручного копирования до закрытия окна. */
export function ShareDialog() {
  const data = useGame((s) => s.shareFallback);
  return data ? <ShareDialogContent data={data} /> : null;
}

function ShareDialogContent({ data }: { data: SharePayload }) {
  const { lang, t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<ShareIdentity>(data.identity);
  const [generated, setGenerated] = useState<SharePayload>(data);
  const [updating, setUpdating] = useState(false);
  const toast = (text: string, tone: 'good' | 'bad' = 'good') => useGame.getState().showToast(text, tone);
  const close = () => {
    useGame.setState({ shareFallback: null });
    toast(getI18n().t.ui.challenge.close);
  };
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); close();
      } else if (e.key === 'Enter') {
        // Enter в поле или на ссылке не закрывает лежащее под ним окно итогов.
        e.stopImmediatePropagation();
      } else if (e.key === 'Tab') {
        e.stopImmediatePropagation();
        const controls = dialog.current?.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled), a[href]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [data]);
  useEffect(() => {
    let cancelled = false;
    setUpdating(true);
    const timer = window.setTimeout(() => {
      void prepareShare(data.source, data.challenge, identity).then((next) => {
        if (!cancelled) { setGenerated(next); setUpdating(false); }
      }).catch(() => {
        if (!cancelled) toast(getI18n().t.ui.share.failed, 'bad');
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [data, identity.name, identity.gender, lang]);
  const blob = generated.blob;
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  const message = shareContent(data.source, data.challenge, identity);
  const socialText = `${message.message}\n${t.ui.challenge.linkWord}`;
  const content = `${socialText}\n${message.url}`;
  const changeIdentity = (next: ShareIdentity) => { setIdentity(next); saveShareIdentity(next); };
  const copy = async (image: boolean) => {
    setBusy(true);
    try {
      if (image) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(t.ui.challenge.imageCopied);
      } else {
        let rich = false;
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write && (!ClipboardItem.supports || ClipboardItem.supports('text/html'))) {
          try {
            const html = `<p>${escapeHtml(message.message).replace(/\n/g, '<br>')}</p><a href="${escapeHtml(message.url)}">${escapeHtml(t.ui.challenge.linkWord)}</a>`;
            await navigator.clipboard.write([new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([content], { type: 'text/plain' }),
            })]);
            rich = true;
          } catch { /* HTML недоступен — копируем обычное сообщение со ссылкой */ }
        }
        if (!rich) await navigator.clipboard.writeText(content);
        toast(rich ? t.ui.challenge.messageCopiedLink : t.ui.challenge.messageCopied);
      }
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
    { label: t.ui.challenge.sendTelegram, href: `https://t.me/share/url?url=${encodeURIComponent(message.url)}&text=${encodeURIComponent(socialText)}` },
    { label: t.ui.challenge.sendVk, href: `https://vk.com/share.php?url=${encodeURIComponent(message.url)}&title=${encodeURIComponent(socialText)}` },
    { label: t.ui.challenge.sendWhatsApp, href: `https://wa.me/?text=${encodeURIComponent(content)}` },
  ];
  return <div className="modal-backdrop share-backdrop" onClick={close}>
    <div ref={dialog} className="modal panel share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" aria-describedby="share-lead" onClick={(e) => e.stopPropagation()}>
      <h2 id="share-title">{t.ui.challenge.dialogTitle}</h2>
      <p id="share-lead" className="lead">{t.ui.challenge.dialogLead}</p>
      <div className="share-body">
        {preview && <img className="share-preview" src={preview} alt={t.ui.challenge.dialogTitle} />}
        <div className="share-controls">
          <label className="share-name" htmlFor="share-name">{t.ui.challenge.nameLabel}</label>
          <input id="share-name" className="share-name-input" maxLength={20} placeholder={t.ui.challenge.namePlaceholder} value={identity.name} onChange={(e) => changeIdentity({ ...identity, name: e.target.value.replace(/[\u0000-\u001f\u007f]/g, '') })} />
          {lang === 'ru' && <div className="share-gender" role="group">
            {(['male', 'female'] as const).map((gender) => <button key={gender} className="btn ghost" type="button" aria-pressed={identity.gender === gender} onClick={() => changeIdentity({ ...identity, gender: identity.gender === gender ? 'neutral' : gender })}>{gender === 'male' ? t.ui.challenge.he : t.ui.challenge.she}</button>)}
          </div>}
          <textarea className="challenge-link" readOnly value={content} aria-label={t.ui.challenge.copyMessage} onFocus={(e) => e.target.select()} />
          <button className="btn primary" type="button" disabled={busy || updating} onClick={() => void copy(true)}>{t.ui.challenge.copyImage}</button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void copy(false)}>{t.ui.challenge.copyMessage}</button>
          <button className="btn ghost" type="button" disabled={!preview || updating} onClick={download}>{t.ui.challenge.download}</button>
          <div className="share-social">{social.map(({ label, href }) => <a key={href} className="btn ghost" href={href} target="_blank" rel="noreferrer" onClick={() => toast(label)}>{label}</a>)}</div>
        </div>
      </div>
      <button className="btn ghost" type="button" onClick={close}>{t.ui.challenge.close}</button>
    </div>
  </div>;
}
