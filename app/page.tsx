"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createLobbyEntryController } from "../lib/lobby-entry";
import { createDisplayNamePreference } from "../lib/display-name-preference";
import { messages, type Locale } from "../lib/i18n";
import { createLobbySession } from "../lib/realtime/session";

export default function HomePage() {
  const router = useRouter();
  const locale: Locale = "fa";
  const text = messages[locale];
  const controller = useMemo(() => createLobbyEntryController(
    createLobbySession(), createDisplayNamePreference(), (code) => router.push(`/lobby/${code}`),
  ), [router]);
  const [displayName, setDisplayName] = useState(() => controller.getDisplayName());
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(action: "create" | "join") {
    setPending(true);
    setError(null);
    try {
      const result = action === "create"
        ? await controller.create(displayName)
        : await controller.join(code, displayName);
      if (!result.ok) setError(controller.getErrorText(locale));
    } catch {
      setError(text.connectionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-8 px-6 py-12" dir="rtl">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-cyan-300">{text.appName}</p>
        <h1 className="text-3xl font-bold">{text.lobbyIntro}</h1>
      </header>
      <label className="grid gap-2 text-sm font-medium">
        {text.displayName}
        <input autoComplete="nickname" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base outline-none focus:border-cyan-400" />
      </label>
      <section className="grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-xl font-semibold">{text.createLobby}</h2>
        <button type="button" disabled={pending} onClick={() => void submit("create")}
          className="rounded-xl bg-cyan-400 px-4 py-3 font-bold text-zinc-950 disabled:opacity-60">
          {pending ? text.joining : text.createAction}
        </button>
      </section>
      <form className="grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5" onSubmit={(event) => { event.preventDefault(); void submit("join"); }}>
        <h2 className="text-xl font-semibold">{text.joinLobby}</h2>
        <label className="grid gap-2 text-sm font-medium">
          {text.lobbyCode}
          <input autoComplete="off" dir="ltr" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-center font-mono text-lg tracking-widest outline-none focus:border-cyan-400" />
        </label>
        <button type="submit" disabled={pending} className="rounded-xl bg-white px-4 py-3 font-bold text-zinc-950 disabled:opacity-60">
          {pending ? text.joining : text.joinAction}
        </button>
      </form>
      {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/60 p-4 text-rose-200">{error}</p>}
    </main>
  );
}
