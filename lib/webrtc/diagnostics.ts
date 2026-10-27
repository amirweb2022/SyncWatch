type DiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

export function logWebRtcDiagnostic(event: string, details: DiagnosticDetails): void {
  if (process.env.NODE_ENV !== "development") return;
  console.debug("[syncwatch-webrtc]", event, details);
}
