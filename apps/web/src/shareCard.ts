import type { ChallengeData } from './challenge';
import { challengeComparison, getI18n, weeksAcc } from './i18n';
import { captureIsland } from './scene/snapshot';
import type { ShareIdentity } from './share';

/** Карточка для телефона: живой остров сверху, результат на тёплой бумаге снизу. */
export async function createShareCard(data: ChallengeData, challenge: ChallengeData | null, site: string, identity: ShareIdentity): Promise<Blob> {
  const snapshot = captureIsland();
  await document.fonts.ready;
  const { lang, t } = getI18n();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 1080, 450);
  gradient.addColorStop(0, '#ffe4b5'); gradient.addColorStop(0.5, '#a5d9d4'); gradient.addColorStop(1, '#3e9a9a');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
  if (snapshot && snapshot.width && snapshot.height) {
    try {
      // Весь остров сохраняется в кадре независимо от пропорций экрана игрока.
      const scale = Math.min(1080 / snapshot.width, 450 / snapshot.height);
      const w = snapshot.width * scale, h = snapshot.height * scale;
      // Поля по бокам — размытая копия снимка на всю ширину: море продолжается до краёв, без «рамки»
      if (w < 1080 && 'filter' in ctx) {
        const cover = Math.max(1080 / snapshot.width, 450 / snapshot.height);
        const cw = snapshot.width * cover, ch = snapshot.height * cover;
        ctx.save();
        ctx.filter = 'blur(28px)';
        ctx.drawImage(snapshot, (1080 - cw) / 2, (450 - ch) / 2, cw, ch);
        ctx.restore();
      }
      ctx.drawImage(snapshot, (1080 - w) / 2, (450 - h) / 2, w, h);
    } catch { /* недоступный WebGL — остаётся градиент */ }
  }
  const veil = ctx.createLinearGradient(0, 370, 0, 450);
  veil.addColorStop(0, 'rgba(255,251,243,0)'); veil.addColorStop(1, '#fffbf3');
  ctx.fillStyle = veil; ctx.fillRect(0, 370, 1080, 80);
  ctx.fillStyle = '#fffbf3'; ctx.fillRect(0, 450, 1080, 900);
  ctx.textBaseline = 'top';
  const text = (value: string, y: number, size: number, maxLines = 1, color = '#1f2a44', display = false) => {
    ctx.font = `${display ? 700 : 600} ${size}px ${display ? 'Unbounded' : 'Manrope'}, sans-serif`;
    // Переносим слова, а длинные непрерывные имена — по символам. Последняя строка ограничена многоточием.
    const lines: string[] = [];
    let line = '';
    for (const word of value.trim().split(/\s+/)) {
      if (ctx.measureText(line ? `${line} ${word}` : word).width <= 936) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (ctx.measureText(line + char).width > 936) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      let last = Array.from(lines[maxLines - 1]);
      while (last.length && ctx.measureText(last.join('') + '…').width > 936) last.pop();
      lines[maxLines - 1] = last.join('').trimEnd() + '…';
    }
    ctx.fillStyle = color;
    lines.slice(0, maxLines).forEach((row, i) => ctx.fillText(row, 72, y + i * size * 1.2));
  };
  const name = identity.name.trim();
  if (name) text(name, 480, 44, 1, '#287a70', true);
  const gender = name && lang === 'ru' ? identity.gender : 'neutral';
  if (data.freedomWeek === null) {
    text(t.ui.challenge.cardProgress(data.progress.at(-1) ?? 0), name ? 552 : 480, 60, 2, '#1f2a44', true);
  } else {
    text(t.ui.challenge.verb[gender], name ? 552 : 480, 48, 2, '#1f2a44', true);
    text(t.ui.challenge.weeks(weeksAcc(data.freedomWeek)), name ? 668 : 596, 68, 1, '#1f2a44', true);
  }
  text(t.ui.challenge.cardExplain, 770, 27, 3);
  text(t.ui.challenge.cardMeta(t.professions[data.profession].title, data.island), 884, 27, 2, '#526079');
  if (challenge && data.freedomWeek !== null) text(challengeComparison(data.freedomWeek, challenge, true), 966, 26, 2, '#287a70');
  text(t.ui.challenge.callTitle, 1050, 36, 1, '#287a70', true);
  text(t.ui.challenge.callText, 1108, 28, 3);
  text(t.ui.challenge.footer, 1240, 22, 1, '#526079');
  text(site, 1290, 26, 1, '#526079');
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG unavailable')), 'image/png'));
}
