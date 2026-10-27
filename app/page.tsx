"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createLobbyEntryController } from "../lib/lobby-entry";
import { createDisplayNamePreference } from "../lib/display-name-preference";
import { messages, type Locale } from "../lib/i18n";
import { getBrowserLobbySession } from "../lib/realtime/browser-session";
import { getUiLocale, readPreferredUiLocale, type UiLocale } from "../lib/ui-locale";
import { LocaleToggle } from "../components/LocaleToggle";

export default function HomePage() {
  return <Suspense fallback={<main className="min-h-[100svh] bg-[var(--background)]" />}><EntryPage /></Suspense>;
}

function EntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [storedLocale, setStoredLocale] = useState<UiLocale | null>(null);
  useEffect(() => {
    try { setStoredLocale(readPreferredUiLocale(window.localStorage)); } catch { setStoredLocale(null); }
  }, []);
  const locale: Locale = getUiLocale(search, storedLocale);
  const text = messages[locale];
  const controller = useMemo(() => createLobbyEntryController(
    getBrowserLobbySession(), createDisplayNamePreference(), (code) => router.push(`/lobby/${code}`),
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
    <main lang={locale} className="relative mx-auto flex min-h-[100svh] w-full max-w-6xl flex-col justify-center px-4 py-8 sm:px-8" dir={locale === "fa" ? "rtl" : "ltr"}>
      <header className="absolute inset-x-4 top-6 flex items-center gap-3 sm:inset-x-8 sm:top-8">
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-violet-500 text-lg font-black text-white">S</span>
        <span className="text-lg font-bold tracking-tight">{text.appName}</span>
        <LocaleToggle locale={locale} />
      </header>
      <div className="mx-auto grid w-full max-w-4xl items-center gap-10 pt-16 md:grid-cols-[1fr_0.9fr] md:gap-16">
        <section className="space-y-5 text-center ltr:md:text-left rtl:md:text-right">
          <p className="eyebrow">{text.roomReady}</p>
          <h1 className="text-3xl font-bold leading-[1.45] tracking-tight sm:text-4xl md:text-5xl">{text.heroTitle}</h1>
          <p className="mx-auto max-w-lg text-base leading-8 text-zinc-400 md:mx-0 md:text-lg">{text.heroDescription}</p>
          <div className="mx-auto max-w-sm pt-1 md:mx-0">
            <label htmlFor="display-name" className="mb-2 block text-start text-sm font-medium text-zinc-300">{text.displayName}</label>
            <input id="display-name" autoComplete="nickname" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)}
              placeholder={text.nameHint} className="control w-full" />
          </div>
        </section>
        <div className="grid gap-4">
          <section className="surface grid gap-4 rounded-2xl p-5 sm:p-6">
            <div><h2 className="text-lg font-semibold">{text.createLobby}</h2><p className="mt-1 text-sm leading-6 text-zinc-400">{text.lobbyIntro}</p></div>
            <button type="button" disabled={pending} onClick={() => void submit("create")} className="button-primary w-full">
              {pending ? text.joining : text.createAction}
            </button>
          </section>
          <form className="surface grid gap-4 rounded-2xl p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); void submit("join"); }}>
            <div><h2 className="text-lg font-semibold">{text.joinLobby}</h2><p className="mt-1 text-sm text-zinc-400">{text.codeHint}</p></div>
            <label htmlFor="lobby-code" className="sr-only">{text.lobbyCode}</label>
            <input id="lobby-code" autoComplete="off" inputMode="text" dir="ltr" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123" aria-describedby={error ? "entry-error" : undefined}
              className="control w-full text-center font-mono text-xl font-semibold tracking-[0.35em] placeholder:text-zinc-600" />
            <button type="submit" disabled={pending} className="button-secondary w-full">{pending ? text.joining : text.joinAction}</button>
          </form>
          {error && <p id="entry-error" role="alert" aria-live="assertive" className="rounded-xl border border-rose-900/80 bg-rose-950/40 p-4 text-sm leading-6 text-rose-200">{error}</p>}
        </div>
      </div>
      <footer className="pt-10 text-center text-xs text-zinc-500">{text.waitingForFriend}</footer>
    </main>
  );
}
