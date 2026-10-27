"use client";

import type { LobbyRosterView } from "../lib/lobby-presence-ui";
import { messages, type Locale } from "../lib/i18n";
import { UsersIcon } from "./icons";

export function MemberList({ roster, locale, selfMemberId }: {
  readonly roster: LobbyRosterView;
  readonly locale: Locale;
  readonly selfMemberId: string | null;
}) {
  const text = messages[locale];
  return (
    <section aria-labelledby="members-title" className="surface grid gap-4 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="members-title" className="flex items-center gap-2 text-sm font-semibold"><UsersIcon />{text.members}</h2>
        <span role="status" aria-live="polite" className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">{roster.freshness}</span>
      </div>
      {roster.members.length === 0 ? <p className="text-sm text-zinc-400">{text.rosterUnknown}</p> : (
        <ul className="grid gap-2">
          {roster.members.map((member) => (
            <li key={member.memberId} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-zinc-950/70 px-3 py-3 sm:px-4">
              <bdi dir="auto" className="min-w-0 truncate text-start font-medium">{member.displayName}{member.memberId === selfMemberId ? ` (${text.you})` : ""}</bdi>
              <span className="flex items-center gap-2 text-sm text-zinc-300">
                <span aria-label={member.online ? text.online : roster.freshness} className={`size-2 rounded-full ${member.online ? "bg-emerald-400" : "bg-amber-400"}`} />
                {member.role && <span>{member.role}</span>}
                {!member.online && <span>{roster.freshness}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
