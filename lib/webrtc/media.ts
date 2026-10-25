import type { QualityPreset } from "../realtime/events";

export interface CaptureConstraints {
  readonly audio: true;
  readonly video: {
    readonly width: { readonly ideal: number };
    readonly height: { readonly ideal: number };
    readonly frameRate: { readonly ideal: 30 };
  };
}

const QUALITY_DIMENSIONS: Readonly<Record<QualityPreset, readonly [number, number]>> = {
  "480p": [854, 480],
  "720p": [1280, 720],
  "1080p": [1920, 1080],
};

export function getCaptureConstraints(preset: QualityPreset = "720p"): CaptureConstraints {
  const [width, height] = QUALITY_DIMENSIONS[preset];
  return { audio: true, video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } } };
}

export function getVideoBitrateLimit(preset: QualityPreset = "720p"): number {
  return preset === "480p" ? 1_000_000 : preset === "1080p" ? 2_500_000 : 2_000_000;
}

interface SenderParameters {
  encodings?: Array<{ maxBitrate?: number }>;
}

interface SenderParameterAdapter {
  getParameters?: () => SenderParameters;
  setParameters?: (parameters: SenderParameters) => Promise<void>;
}

export async function applyVideoBitrateLimit(sender: SenderParameterAdapter, preset: QualityPreset = "720p"): Promise<boolean> {
  if (!sender.getParameters || !sender.setParameters) return false;
  const parameters = sender.getParameters();
  if (!parameters.encodings || parameters.encodings.length === 0) return false;
  parameters.encodings[0] = { ...parameters.encodings[0], maxBitrate: getVideoBitrateLimit(preset) };
  try {
    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}
