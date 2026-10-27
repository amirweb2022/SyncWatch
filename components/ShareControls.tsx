"use client";
import type { QualityPreset } from "../lib/realtime/events";
import type { StreamSession } from "../lib/webrtc/session";
import { getStreamUiView } from "../lib/stream-ui";
import { messages, type Locale } from "../lib/i18n";
import { ScreenShare } from "./icons";

const QUALITY_PRESETS = ["480p", "720p", "1080p"] as const;

export function ShareControls({ session, locale, view, desktop, host, quality, onQuality }: { session: StreamSession; locale: Locale; view: ReturnType<typeof getStreamUiView>; desktop: boolean; host: boolean; quality: QualityPreset; onQuality(value: QualityPreset): void }) {
  const text = messages[locale];
  return <section className="surface grid gap-4 rounded-2xl p-4 sm:p-5" aria-label={text.shareStart}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{host ? text.roleHost : text.viewer}</h2><p role={view.alert ? "alert" : "status"} aria-live={view.alert ? "assertive" : "polite"} className="text-xs text-zinc-400">{view.status}</p></div>
    {view.canStart && <><p className="rounded-xl border border-zinc-700/80 bg-zinc-950/60 p-3 text-sm leading-6 text-zinc-300">{text.desktopCaptureOnly} {text.captureHint}</p><label className="grid gap-2 text-sm font-medium">{text.quality}<select className="control w-full" value={quality} onChange={(event) => { const next = event.target.value; if ((QUALITY_PRESETS as readonly string[]).includes(next)) onQuality(next as QualityPreset); }}>{view.qualities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" onClick={() => void session.start(quality)} className="button-primary w-full"><ScreenShare />{text.shareStart}</button></>}
    {view.canStop && <><p role="status" className="text-sm text-emerald-200">{text.activeShare}</p><button type="button" onClick={() => void session.stop()} className="button-danger w-full">{text.stopSharing}</button></>}
    {view.canRequest && <button type="button" onClick={() => void session.requestShare()} className="button-primary w-full">{text.shareRequest}</button>}
    {host && !desktop && <p role="status" className="text-sm leading-6 text-amber-200">{text.desktopCaptureOnly}</p>}
  </section>;
}
