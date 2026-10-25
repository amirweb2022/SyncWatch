"use client";
import { useEffect, useRef, useState } from "react";
import { attemptPlayback, requestFullscreen } from "../lib/webrtc/media-element";
import { messages, type Locale } from "../lib/i18n";

export function VideoStage({ stream, locale, muted, status, onPlaying, onWaiting }: { stream: MediaStream | null; locale: Locale; muted: boolean; status: string; onPlaying?(): void; onWaiting?(): void }) {
  const ref = useRef<HTMLVideoElement>(null); const [blocked, setBlocked] = useState(false); const [fullscreenError, setFullscreenError] = useState(false); const text = messages[locale];
  const onPlayingRef = useRef(onPlaying);
  const onWaitingRef = useRef(onWaiting);
  useEffect(() => { onPlayingRef.current = onPlaying; onWaitingRef.current = onWaiting; }, [onPlaying, onWaiting]);
  useEffect(() => { const video = ref.current; if (!video) return; video.srcObject = stream; if (stream) void attemptPlayback(video).then((ok) => setBlocked(!ok)); return () => { video.pause(); video.srcObject = null; }; }, [stream]);
  async function playFromGesture() { const video = ref.current; if (video) setBlocked(!(await attemptPlayback(video))); }
  async function fullscreenFromGesture() { const video = ref.current; if (video) setFullscreenError(!(await requestFullscreen(video))); }
  return <section className="grid gap-3 rounded-2xl border border-zinc-800 bg-black p-3" aria-label={status}>
    <video ref={ref} autoPlay playsInline muted={muted} onPlaying={() => { setBlocked(false); onPlayingRef.current?.(); }} onWaiting={() => onWaitingRef.current?.()} className="aspect-video w-full rounded-xl bg-zinc-950" aria-label={status} />
    <div className="flex flex-wrap gap-3"><span role="status" aria-live="polite">{status}</span>{blocked && stream && <button type="button" onClick={() => void playFromGesture()} className="rounded-lg bg-cyan-400 px-3 py-2 font-semibold text-zinc-950">{text.enablePlayback}</button>}{stream && <button type="button" onClick={() => void fullscreenFromGesture()} className="rounded-lg border border-zinc-700 px-3 py-2">{text.fullscreen}</button>}{fullscreenError && <span role="alert">{text.fullscreenFailed}</span>}</div>
  </section>;
}
