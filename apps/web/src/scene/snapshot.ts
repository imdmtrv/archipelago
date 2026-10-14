let capture: (() => HTMLCanvasElement) | null = null;

/** Сцена регистрирует захват, чтобы снимок делался сразу после рендера WebGL. */
export function registerIslandCapture(callback: () => HTMLCanvasElement) {
  capture = callback;
  return () => { if (capture === callback) capture = null; };
}

export function captureIsland(): HTMLCanvasElement | null {
  try { return capture?.() ?? null; } catch { return null; }
}
