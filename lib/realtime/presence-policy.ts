import { MAX_LOBBY_MEMBERS } from "../config";
import { parsePresenceMetadata, type PresenceMetadata } from "./events";

export type PresenceSnapshot = Readonly<Record<string, readonly unknown[]>>;

export type AdmissionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "unavailable" | "full" };

function compareMembers(left: PresenceMetadata, right: PresenceMetadata): number {
  const leftValid = Number.isFinite(left.joinedAt);
  const rightValid = Number.isFinite(right.joinedAt);
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (leftValid && rightValid && left.joinedAt !== right.joinedAt) return left.joinedAt - right.joinedAt;
  return left.memberId.localeCompare(right.memberId);
}

function shouldReplaceDuplicate(current: PresenceMetadata, candidate: PresenceMetadata): boolean {
  const currentValid = Number.isFinite(current.joinedAt);
  const candidateValid = Number.isFinite(candidate.joinedAt);
  if (currentValid !== candidateValid) return candidateValid;
  if (currentValid && candidateValid && candidate.joinedAt !== current.joinedAt) {
    return candidate.joinedAt > current.joinedAt;
  }
  return candidate.displayName.localeCompare(current.displayName) < 0;
}

export function normalizePresenceSnapshot(snapshot: PresenceSnapshot): readonly PresenceMetadata[] {
  const byMemberId = new Map<string, PresenceMetadata>();
  for (const entries of Object.values(snapshot)) {
    for (const entry of entries) {
      const member = normalizeMemberForOrdering(entry);
      if (!member) continue;
      const existing = byMemberId.get(member.memberId);
      if (!existing || shouldReplaceDuplicate(existing, member)) byMemberId.set(member.memberId, member);
    }
  }
  return Object.freeze([...byMemberId.values()].sort(compareMembers));
}

function normalizeMemberForOrdering(value: unknown): PresenceMetadata | null {
  return parsePresenceMetadata(value);
}

export function electHost(members: readonly PresenceMetadata[]): PresenceMetadata | null {
  return [...members].sort(compareMembers)[0] ?? null;
}

export function decideObservedAdmission(
  members: readonly PresenceMetadata[],
  joiningMemberId: string,
): AdmissionDecision {
  const observedOthers = new Set(
    members.filter((member) => member.memberId !== joiningMemberId).map((member) => member.memberId),
  );
  if (observedOthers.size === 0) return { allowed: false, reason: "unavailable" };
  if (observedOthers.size >= MAX_LOBBY_MEMBERS) return { allowed: false, reason: "full" };
  return { allowed: true };
}
