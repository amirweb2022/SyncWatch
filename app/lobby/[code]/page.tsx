"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MemberList } from "../../../components/MemberList";
import { createDisplayNamePreference } from "../../../lib/display-name-preference";
import { validateLobbyCode } from "../../../lib/code";
import { createLobbyPresenceController, getLobbyConnectionErrorText, getLobbyRosterView } from "../../../lib/lobby-presence-ui";
import { messages, type Locale } from "../../../lib/i18n";
import { getBrowserLobbySession } from "../../../lib/realtime/browser-session";
import { useLobbyStore } from "../../../store/lobby";

export default function LobbyPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const locale: Locale = "fa";
  const text = messages[locale];
  const [session] = useState(() => getBrowserLobbySession());
  const [displayName] = useState(() => createDisplayNamePreference().load());
  const memberName = displayName || text.unknownMember;
  const [actionPending, setActionPending] = useState(false);
  const snapshot = useLobbyStore((state) => state);
  const bind = useLobbyStore((state) => state.bind);
  const reset = useLobbyStore((state) => state.reset);
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

  async function retry() {
    setActionPending(true);
    try { await controller.retry(); } finally { setActionPending(false); }
  }

  async function leave() {
    setActionPending(true);
    try { await controller.leave(); } finally { setActionPending(false); }
  }

  const connection = controller.getConnectionView();
  const connectionError = getLobbyConnectionErrorText(snapshot, locale);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-6 py-10" dir="rtl">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-cyan-300">{text.appName}</p>
          <h1 className="text-2xl font-bold">{text.lobbyCode}: <bdi dir="ltr" className="font-mono tracking-widest">{params.code}</bdi></h1>
        </div>
        <span role="status" className="rounded-full border border-zinc-700 px-3 py-2 text-sm">{connection.label}</span>
      </header>

      <MemberList roster={roster} locale={locale} selfMemberId={snapshot.selfMemberId} />

      {connectionError && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/60 p-4 text-rose-200">{connectionError}</p>}

      <div className="grid gap-3">
        {connection.retryAvailable && <button type="button" disabled={actionPending} onClick={() => void retry()}
          className="rounded-xl bg-cyan-400 px-4 py-3 font-bold text-zinc-950 disabled:opacity-60">{text.retry}</button>}
        <button type="button" disabled={actionPending} onClick={() => void leave()}
          className="rounded-xl border border-zinc-700 px-4 py-3 font-semibold disabled:opacity-60">{text.leaveLobby}</button>
      </div>
    </main>
  );
}
