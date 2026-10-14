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
  const gradient = ctx.createLinearGradient(0, 0, 1080, 800);
  gradient.addColorStop(0, '#ffe4b5'); gradient.addColorStop(0.5, '#a5d9d4'); gradient.addColorStop(1, '#3e9a9a');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
  if (snapshot && snapshot.width && snapshot.height) {
    try {
      // Весь остров сохраняется в кадре независимо от пропорций экрана игрока.
      const scale = Math.min(1080 / snapshot.width, 800 / snapshot.height);
      const w = snapshot.width * scale, h = snapshot.height * scale;
      ctx.drawImage(snapshot, (1080 - w) / 2, (800 - h) / 2, w, h);
    } catch { /* недоступный WebGL — остаётся градиент */ }
  }
  const veil = ctx.createLinearGradient(0, 620, 0, 840);
  veil.addColorStop(0, 'rgba(255,251,243,0)'); veil.addColorStop(1, '#fffbf3');
  ctx.fillStyle = veil; ctx.fillRect(0, 620, 1080, 220);
  ctx.fillStyle = '#fffbf3'; ctx.fillRect(0, 840, 1080, 510);
  const text = (value: string, y: number, size: number, color = '#1f2a44', display = false) => {
    ctx.font = `${display ? 700 : 600} ${size}px ${display ? 'Unbounded' : 'Manrope'}, sans-serif`;
    while (ctx.measureText(value).width > 936 && size > 20) {
      size -= 1; ctx.font = `${display ? 700 : 600} ${size}px ${display ? 'Unbounded' : 'Manrope'}, sans-serif`;
    }
    ctx.fillStyle = color; ctx.fillText(value, 72, y);
  };
  text(t.meta.app, 90, 48, '#1f2a44', true);
  text(data.island, 854, 32, '#526079');
  text(data.freedomWeek === null ? t.ui.challenge.cardProgress(data.progress.at(-1) ?? 0) : t.ui.challenge.cardFreedom, 944, 58, '#1f2a44', true);
  text(t.ui.challenge.cardWeeks(weeksAcc(data.freedomWeek ?? data.week)), 1015, 46, '#1f2a44', true);
  if (challenge && data.freedomWeek !== null) text(challengeComparison(data.freedomWeek, challenge, true), 1090, 30, '#287a70');
  text(t.ui.challenge.faster, 1196, 44, '#287a70', true);
  text(site, 1280, 30, '#526079');
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG unavailable')), 'image/png'));
}
