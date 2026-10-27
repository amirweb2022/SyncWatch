"use client";

import { messages, type Locale } from "../lib/i18n";
import { CheckIcon, CopyIcon, LeaveIcon } from "./icons";
import { LocaleToggle } from "./LocaleToggle";

export function LobbyHeader({ code, locale, connection, copyDone, pending, onCopy, onLeave }: {
  readonly code: string;
  readonly locale: Locale;
  readonly connection: string;
  readonly copyDone: boolean;
  readonly pending: boolean;
  onCopy(): void;
  onLeave(): void;
}) {
  const text = messages[locale];
  return (
    <header className="surface flex flex-wrap items-center justify-between gap-3 rounded-2xl px-3 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-base font-black text-white">S</span>
        <div className="min-w-0"><p className="text-sm font-bold">{text.appName}</p><p className="mt-0.5 truncate text-xs text-zinc-400">{text.roomReady}</p></div>
        <span className="mx-1 hidden h-8 w-px bg-zinc-700 sm:block" aria-hidden="true" />
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-zinc-950/70 px-2.5 py-2 sm:px-3"><span className="hidden text-xs text-zinc-400 sm:inline">{text.lobbyCode}</span><bdi dir="ltr" className="font-mono text-sm font-bold tracking-[0.16em] sm:tracking-[0.2em]">{code}</bdi></div>
        <button type="button" onClick={onCopy} className="button-ghost min-h-11 min-w-11 px-2 sm:px-3" aria-label={copyDone ? text.copied : text.copyCode}>{copyDone ? <CheckIcon /> : <CopyIcon />}<span className="hidden sm:inline">{copyDone ? text.copied : text.copyCode}</span></button>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <span role="status" aria-live="polite" className="connection-badge"><span aria-hidden="true" className="connection-dot" />{connection}</span>
        <LocaleToggle locale={locale} />
        <button type="button" disabled={pending} onClick={onLeave} className="button-ghost min-h-11 px-2 text-sm text-zinc-300 sm:px-3" aria-label={text.leaveLobby}><LeaveIcon /><span className="hidden sm:inline">{text.leaveLobby}</span></button>
      </div>
    </header>
  );
}
