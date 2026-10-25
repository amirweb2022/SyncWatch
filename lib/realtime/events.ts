export interface EventBase {
  senderId: string;
}

export interface TargetedEvent extends EventBase {
  targetId: string;
}

export type GenerationId = string;
export type QualityPreset = "480p" | "720p" | "1080p";
export type StreamFailure = "capture-unsupported" | "capture-denied" | "capture-failed" | "connection-failed" | "playback-failed";
export type StreamStatus = "idle" | "requesting-capture" | "sharing" | "loading" | "connecting" | "playing" | "interrupted" | "failed";

export type RealtimeEvent =
  | (TargetedEvent & { type: "rtc:offer"; sessionId: GenerationId; description: RTCSessionDescriptionInit })
  | (TargetedEvent & { type: "rtc:answer"; sessionId: GenerationId; description: RTCSessionDescriptionInit })
  | (TargetedEvent & { type: "rtc:ice"; sessionId: GenerationId; candidate: RTCIceCandidateInit })
  | (EventBase & { type: "share:started"; sessionId: GenerationId })
  | (EventBase & { type: "share:stopped"; sessionId: GenerationId })
  | (EventBase & { type: "share:request"; sessionId: GenerationId })
  | (EventBase & {
      type: "chat:message";
      messageId: string;
      name: string;
      text: string;
      sentAt: number;
    });

export interface PresenceMetadata {
  readonly memberId: string;
  readonly displayName: string;
  readonly joinedAt: number;
}

const MAX_ID_LENGTH = 128;
const MAX_GENERATION_ID_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 1_000_000;
const MAX_CANDIDATE_LENGTH = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isBoundedIdentifier(value: unknown, maximum: number): value is string {
  return isBoundedString(value, maximum) && !/\p{Cc}/u.test(value);
}

function isIdentifier(value: unknown): value is string {
  return isBoundedIdentifier(value, MAX_ID_LENGTH);
}

function isGenerationId(value: unknown): value is GenerationId {
  return isBoundedIdentifier(value, MAX_GENERATION_ID_LENGTH);
}

function parseDescription(value: unknown): RTCSessionDescriptionInit | null {
  if (!isRecord(value) || (value.type !== "offer" && value.type !== "answer")) return null;
  if (!isBoundedString(value.sdp, MAX_DESCRIPTION_LENGTH)) return null;
  return Object.freeze({ type: value.type, sdp: value.sdp });
}

function parseCandidate(value: unknown): RTCIceCandidateInit | null {
  if (!isRecord(value) || !isBoundedString(value.candidate, MAX_CANDIDATE_LENGTH)) return null;
  const sdpMid = value.sdpMid;
  const sdpMLineIndex = value.sdpMLineIndex;
  const usernameFragment = value.usernameFragment;
  if (sdpMid !== undefined && sdpMid !== null && !isBoundedString(sdpMid, MAX_ID_LENGTH)) return null;
  if (sdpMLineIndex !== undefined && sdpMLineIndex !== null &&
      (typeof sdpMLineIndex !== "number" || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0)) return null;
  if (usernameFragment !== undefined && usernameFragment !== null && !isBoundedString(usernameFragment, MAX_ID_LENGTH)) return null;
  return Object.freeze({
    candidate: value.candidate,
    ...(sdpMid === undefined ? {} : { sdpMid }),
    ...(sdpMLineIndex === undefined ? {} : { sdpMLineIndex }),
    ...(usernameFragment === undefined ? {} : { usernameFragment }),
  });
}

export function parseRealtimeEvent(value: unknown): RealtimeEvent | null {
  if (!isRecord(value) || !isIdentifier(value.senderId)) return null;
  const senderId = value.senderId;
  switch (value.type) {
    case "rtc:offer":
    case "rtc:answer": {
      if (!isIdentifier(value.targetId) || value.targetId === senderId || !isGenerationId(value.sessionId)) return null;
      const description = parseDescription(value.description);
      if (!description || (value.type === "rtc:offer" && description.type !== "offer") ||
          (value.type === "rtc:answer" && description.type !== "answer")) return null;
      return Object.freeze({ type: value.type, senderId, targetId: value.targetId, sessionId: value.sessionId, description });
    }
    case "rtc:ice": {
      if (!isIdentifier(value.targetId) || value.targetId === senderId || !isGenerationId(value.sessionId)) return null;
      const candidate = parseCandidate(value.candidate);
      return candidate ? Object.freeze({ type: "rtc:ice", senderId, targetId: value.targetId, sessionId: value.sessionId, candidate }) : null;
    }
    case "share:started":
    case "share:stopped":
    case "share:request":
      return isGenerationId(value.sessionId) ? Object.freeze({ type: value.type, senderId, sessionId: value.sessionId }) : null;
    case "chat:message": {
      const { messageId, name, text, sentAt } = value;
      if (!isIdentifier(messageId) || !isBoundedString(name, 40) ||
          typeof text !== "string" || text.length > 500 ||
          typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
      return Object.freeze({ type: "chat:message", senderId, messageId, name, text, sentAt });
    }
    default:
      return null;
  }
}

export function parsePresenceMetadata(value: unknown): PresenceMetadata | null {
  if (!isRecord(value) || !isIdentifier(value.memberId) || typeof value.displayName !== "string" ||
      typeof value.joinedAt !== "number" || !Number.isFinite(value.joinedAt)) return null;
  const displayName = value.displayName.normalize("NFC").trim();
  if (displayName.length === 0 || [...displayName].length > 40 || /\p{Cc}/u.test(displayName)) return null;
  return Object.freeze({
    memberId: value.memberId,
    displayName,
    joinedAt: value.joinedAt,
  });
}
