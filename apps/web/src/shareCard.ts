import type { ChallengeData } from './challenge';
import { challengeComparison, getI18n, weeksAcc } from './i18n';
import { captureIsland } from './scene/snapshot';

/** Карточка для телефона: живой остров сверху, результат на тёплой бумаге снизу. */
export async function createShareCard(data: ChallengeData, challenge: ChallengeData | null, site: string): Promise<Blob> {
  const snapshot = captureIsland();
  await document.fonts.ready;
  const { t } = getI18n();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 1080, 520);
  gradient.addColorStop(0, '#ffe4b5'); gradient.addColorStop(0.5, '#a5d9d4'); gradient.addColorStop(1, '#3e9a9a');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
  if (snapshot && snapshot.width && snapshot.height) {
    try {
      // Весь остров сохраняется в кадре независимо от пропорций экрана игрока.
      const scale = Math.min(1080 / snapshot.width, 520 / snapshot.height);
      const w = snapshot.width * scale, h = snapshot.height * scale;
      ctx.drawImage(snapshot, (1080 - w) / 2, (520 - h) / 2, w, h);
    } catch { /* недоступный WebGL — остаётся градиент */ }
  }
  const veil = ctx.createLinearGradient(0, 440, 0, 520);
  veil.addColorStop(0, 'rgba(255,251,243,0)'); veil.addColorStop(1, '#fffbf3');
  ctx.fillStyle = veil; ctx.fillRect(0, 440, 1080, 80);
  ctx.fillStyle = '#fffbf3'; ctx.fillRect(0, 520, 1080, 830);
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
  text(t.meta.app, 546, 46, 1, '#1f2a44', true);
  text(t.ui.challenge.cardTagline, 604, 32, 1, '#526079');
  // Ограничиваем именно имя, чтобы длинное имя не вытеснило результат и число недель.
  ctx.font = '700 52px Unbounded, sans-serif';
  const nameChars = Array.from(data.name);
  while (nameChars.length && ctx.measureText(nameChars.join('') + '…').width > 650) nameChars.pop();
  const name = nameChars.length < Array.from(data.name).length ? nameChars.join('').trimEnd() + '…' : data.name;
  const headline = data.freedomWeek === null ? `${name}: ${t.ui.challenge.cardProgress(data.progress.at(-1) ?? 0)}`
    : t.ui.challenge.cardHeadline(name, weeksAcc(data.freedomWeek));
  text(headline, 652, 52, 3, '#1f2a44', true);
  text(t.ui.challenge.cardExplain, 854, 34, 3);
  text(t.ui.challenge.cardMeta(t.professions[data.profession].title, data.island), 990, 34, 2, '#526079');
  if (challenge && data.freedomWeek !== null) text(challengeComparison(data.freedomWeek, challenge, true), 1080, 32, 2, '#287a70');
  text(t.ui.challenge.cardCall, 1170, 34, 2, '#287a70');
  text(site, 1290, 30, 1, '#526079');
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG unavailable')), 'image/png'));
}
