let available: boolean | undefined;

/** Пробный контекст не занимает место у игровой сцены. */
export function webglAvailable(): boolean {
  if (available !== undefined) return available;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    available = !!context;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { available = false; }
  return available;
}
