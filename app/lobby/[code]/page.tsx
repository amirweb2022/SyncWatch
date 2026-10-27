"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { MemberList } from "../../../components/MemberList";
import { createDisplayNamePreference } from "../../../lib/display-name-preference";
import { validateLobbyCode } from "../../../lib/code";
import { createLobbyPresenceController, getLobbyConnectionErrorText, getLobbyRosterView } from "../../../lib/lobby-presence-ui";
import { messages, type Locale } from "../../../lib/i18n";
import { getBrowserLobbySession } from "../../../lib/realtime/browser-session";
import { useLobbyStore } from "../../../store/lobby";
import { useStreamStore } from "../../../store/stream";
import { getStreamUiView } from "../../../lib/stream-ui";
import { ShareControls } from "../../../components/ShareControls";
import { VideoStage } from "../../../components/VideoStage";
import { createStreamSession } from "../../../lib/webrtc/session";
import { createCaptureManager } from "../../../lib/webrtc/capture";
import { LinkIcon } from "../../../components/icons";
import { LobbyHeader } from "../../../components/LobbyHeader";
import { getUiLocale, readPreferredUiLocale, type UiLocale } from "../../../lib/ui-locale";

export default function LobbyPage() {
  return <Suspense fallback={<main className="min-h-[100svh] bg-[var(--background)]" />}><LobbyContent /></Suspense>;
}

function LobbyContent() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [storedLocale, setStoredLocale] = useState<UiLocale | null>(null);
  useEffect(() => {
    try { setStoredLocale(readPreferredUiLocale(window.localStorage)); } catch { setStoredLocale(null); }
  }, []);
  const locale: Locale = getUiLocale(search, storedLocale);
  const text = messages[locale];
  const [session] = useState(() => getBrowserLobbySession());
  const [streamSession, setStreamSession] = useState<ReturnType<typeof createStreamSession> | null>(null);
  const [media, setMedia] = useState<{ local: MediaStream | null; remote: MediaStream | null; audio: "present" | "missing" | null }>({ local: null, remote: null, audio: null });
  const [quality, setQuality] = useState<"480p" | "720p" | "1080p">("720p");
  const [displayName] = useState(() => createDisplayNamePreference().load());
  const memberName = displayName || text.unknownMember;
  const [actionPending, setActionPending] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const snapshot = useLobbyStore((state) => state);
  const bind = useLobbyStore((state) => state.bind);
  const reset = useLobbyStore((state) => state.reset);
  const streamSnapshot = useStreamStore((state) => state);
  const bindStream = useStreamStore((state) => state.bind);
  const roster = useMemo(() => getLobbyRosterView(snapshot, locale), [snapshot, locale]);
  const navigate = useCallback((path: string) => router.replace(path), [router]);
  const controller = useMemo(() => createLobbyPresenceController(session, locale, navigate), [session, locale, navigate]);

  useEffect(() => {
    const unsubscribe = bind(session);
    const current = session.getSnapshot();
    const validatedCode = validateLobbyCode(params.code);
    if (current.status === "idle") {
      if (!validatedCode.valid) {
        router.replace("/");
      } else {
        void Promise.resolve(session.join(validatedCode.code, memberName)).then((result) => {
          if (!result.ok) router.replace("/");
        });
      }
    }
    return unsubscribe;
  }, [bind, memberName, params.code, reset, router, session]);

  useEffect(() => {
    const coordinator = createStreamSession({
      lobby: session,
      channel: { send: (event) => session.sendRealtimeEvent(event), onEvent: (listener) => session.subscribeRealtimeEvents(listener) },
      capture: createCaptureManager(),
    });
    setStreamSession(coordinator);
    const unbind = bindStream(coordinator);
    const unbindMedia = coordinator.subscribeMedia(setMedia);
    setMedia(coordinator.getMedia());
    return () => { unbind(); unbindMedia(); void coordinator.dispose(); };
  }, [bindStream, session]);
  const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const streamView = getStreamUiView(streamSnapshot, desktop, text);

  async function retry() {
    setActionPending(true);
    try { await controller.retry(); } finally { setActionPending(false); }
  }

  async function leave() {
    setActionPending(true);
    try { if (streamSession) await streamSession.stop(); await controller.leave(); } finally { setActionPending(false); }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(params.code);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 1800);
    } catch {
      setCopyDone(false);
    }
  }

  const connection = controller.getConnectionView();
  const connectionError = getLobbyConnectionErrorText(snapshot, locale);
  return (
    <main lang={locale} className="mx-auto flex min-h-[100svh] w-full max-w-[1600px] flex-col gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-5 sm:px-6 sm:py-6 lg:px-8" dir={locale === "fa" ? "rtl" : "ltr"}>
      <LobbyHeader code={params.code} locale={locale} connection={connection.label} copyDone={copyDone} pending={actionPending} onCopy={() => void copyCode()} onLeave={() => void leave()} />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5">
        <section className="min-w-0 space-y-3" aria-label={text.videoPlaceholder}>
          <VideoStage stream={streamSnapshot.role === "host" ? media.local : media.remote} locale={locale} muted={streamSnapshot.role === "host"} status={streamView.status} onPlaying={() => streamSession?.reportPlayback(true)} onWaiting={() => streamSession?.reportPlayback(false)} />
          {streamSnapshot.role === "host" && media.audio === "missing" && <p role="status" className="rounded-xl border border-amber-900/80 bg-amber-950/30 p-3 text-sm text-amber-200">{text.missingAudio}</p>}
          {connectionError && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-rose-200">{connectionError}</p>}
          {connection.retryAvailable && <button type="button" disabled={actionPending} onClick={() => void retry()} className="button-primary w-full sm:w-auto">{text.retry}</button>}
        </section>
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <div className="surface rounded-2xl p-4"><p className="mb-3 flex items-center gap-2 text-sm font-semibold"><LinkIcon />{snapshot.members.length < 2 ? text.waitingForFriend : text.activeShare}</p><p className="text-xs leading-5 text-zinc-400">{text.hostWaitHint}</p></div>
          <MemberList roster={roster} locale={locale} selfMemberId={snapshot.selfMemberId} />
          {streamSession && <ShareControls session={streamSession} locale={locale} view={streamView} desktop={desktop} host={streamSnapshot.role === "host"} quality={quality} onQuality={setQuality} />}
        </aside>
      </div>
    </main>
  );
}
