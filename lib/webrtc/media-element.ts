export interface PlaybackElement {
  play(): Promise<void>;
}

export interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
}

export async function attemptPlayback(element: PlaybackElement): Promise<boolean> {
  try { await element.play(); return true; } catch { return false; }
}

export async function requestFullscreen(element: FullscreenElement): Promise<boolean> {
  if (!element.requestFullscreen) return false;
  try { await element.requestFullscreen(); return true; } catch { return false; }
}
