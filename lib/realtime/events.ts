export interface EventBase {
  senderId: string;
}

export interface TargetedEvent extends EventBase {
  targetId: string;
}

export type RealtimeEvent =
  | (TargetedEvent & { type: "rtc:offer"; description: RTCSessionDescriptionInit })
  | (TargetedEvent & { type: "rtc:answer"; description: RTCSessionDescriptionInit })
  | (TargetedEvent & { type: "rtc:ice"; candidate: RTCIceCandidateInit })
  | (EventBase & { type: "share:started" })
  | (EventBase & { type: "share:stopped" })
  | (EventBase & { type: "share:request" })
  | (EventBase & {
      type: "chat:message";
      messageId: string;
      name: string;
      text: string;
      sentAt: number;
    });
