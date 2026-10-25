"use client";
import type { QualityPreset } from "../lib/realtime/events";
import type { StreamSession } from "../lib/webrtc/session";
import { getStreamUiView } from "../lib/stream-ui";
import { messages, type Locale } from "../lib/i18n";

export function ShareControls({ session, locale, view, desktop, host, quality, onQuality }: { session: StreamSession; locale: Locale; view: ReturnType<typeof getStreamUiView>; desktop: boolean; host: boolean; quality: QualityPreset; onQuality(value: QualityPreset): void }) {
  const text = messages[locale];
  return <section className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5" aria-label={text.shareStart}>
    <p role={view.alert ? "alert" : "status"} aria-live={view.alert ? "assertive" : "polite"}>{view.status}</p>
    {view.canStart && <><p className="text-sm text-zinc-300">{text.desktopCaptureOnly} {text.captureHint}</p><label className="grid gap-2">{text.quality}<select className="rounded-lg bg-zinc-950 p-3" value={quality} onChange={(event) => onQuality(event.target.value as QualityPreset)}>{view.qualities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" onClick={() => void session.start(quality)} className="rounded-xl bg-cyan-400 p-3 font-bold text-zinc-950">{text.shareStart}</button></>}
    {view.canStop && <><p role="status">{text.shareActive}</p><button type="button" onClick={() => void session.stop()} className="rounded-xl border border-zinc-700 p-3">{text.shareStop}</button></>}
    {view.canRequest && <button type="button" onClick={() => void session.requestShare()} className="rounded-xl bg-cyan-400 p-3 font-bold text-zinc-950">{text.shareRequest}</button>}
    {host && !desktop && <p>{text.desktopCaptureOnly}</p>}
  </section>;
}
