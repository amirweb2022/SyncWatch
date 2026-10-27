"use client";
import { useEffect, useRef, useState } from "react";
import { attemptPlayback, requestFullscreen } from "../lib/webrtc/media-element";
import { messages, type Locale } from "../lib/i18n";
import { Maximize, Play, ScreenShare } from "./icons";
import { logWebRtcDiagnostic } from "../lib/webrtc/diagnostics";

export function VideoStage({ stream, locale, muted, status, onPlaying, onWaiting }: { stream: MediaStream | null; locale: Locale; muted: boolean; status: string; onPlaying?(): void; onWaiting?(): void }) {
  const ref = useRef<HTMLVideoElement>(null); const [blocked, setBlocked] = useState(false); const [fullscreenError, setFullscreenError] = useState(false); const text = messages[locale];
  const onPlayingRef = useRef(onPlaying);
  const onWaitingRef = useRef(onWaiting);
  useEffect(() => { onPlayingRef.current = onPlaying; onWaitingRef.current = onWaiting; }, [onPlaying, onWaiting]);
  useEffect(() => { const video = ref.current; if (!video) return; video.srcObject = stream; if (stream) void attemptPlayback(video).then((ok) => { setBlocked(!ok); if (!ok) logWebRtcDiagnostic("video playback error", { reason: "autoplay-blocked" }); }); return () => { video.pause(); video.srcObject = null; }; }, [stream]);
  async function playFromGesture() { const video = ref.current; if (video) { const ok = await attemptPlayback(video); setBlocked(!ok); if (!ok) logWebRtcDiagnostic("video playback error", { reason: "playback-rejected-after-gesture" }); } }
  async function fullscreenFromGesture() { const video = ref.current; if (video) setFullscreenError(!(await requestFullscreen(video))); }
  return <section className="grid gap-3" aria-label={status}>
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      <video ref={ref} autoPlay playsInline muted={muted} onPlaying={() => { setBlocked(false); onPlayingRef.current?.(); }} onWaiting={() => onWaitingRef.current?.()} className="aspect-video max-h-[72vh] w-full bg-[#0c0c12] object-contain" aria-label={status} />
      {!stream && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0c0c12] px-6 text-center">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 text-violet-300"><ScreenShare /></span>
        <div className="space-y-2"><h2 className="text-base font-semibold sm:text-lg">{text.videoPlaceholder}</h2><p className="max-w-md text-sm leading-6 text-zinc-400">{text.videoPlaceholderHint}</p></div>
      </div>}
      {blocked && stream && <button type="button" onClick={() => void playFromGesture()} className="button-primary absolute inset-0 m-auto h-fit w-fit shadow-xl"><Play />{text.enablePlayback}</button>}
      {stream && <button type="button" aria-label={text.fullscreen} onClick={() => void fullscreenFromGesture()} className="absolute bottom-3 end-3 grid size-11 place-items-center rounded-xl border border-white/15 bg-black/70 text-white backdrop-blur-sm hover:bg-black/90"><Maximize /></button>}
      <span className="absolute start-3 top-3 rounded-lg border border-white/10 bg-black/65 px-3 py-1.5 text-xs font-medium text-zinc-100" role="status" aria-live="polite">{status}</span>
    </div>
      {fullscreenError && <span role="alert" className="text-sm text-rose-300">{text.fullscreenFailed}</span>}
  </section>;
}
