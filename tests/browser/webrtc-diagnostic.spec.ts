import { expect, test, type Page } from "@playwright/test";

const interactiveCapture = process.env.SYNCWATCH_REAL_CAPTURE === "1";
const observationTimeout = 10 * 60_000;

test.skip(!interactiveCapture, "Run explicitly with SYNCWATCH_REAL_CAPTURE=1 and a headed browser.");
test.setTimeout(observationTimeout + 90_000);
test.use({ channel: "msedge" });

interface BrowserDiagnostic {
  readonly kind: string;
  readonly details: Readonly<Record<string, unknown>>;
}

async function installDiagnostics(page: Page, name: string, diagnostics: BrowserDiagnostic[]): Promise<void> {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push({ kind: `${name}:console-error`, details: { text: message.text() } });
    if (message.type() === "debug" && message.text().includes("[syncwatch-webrtc]")) {
      const text = message.text();
      const match = /^\[syncwatch-webrtc\]\s+([^\s]+)/.exec(text);
      diagnostics.push({ kind: `${name}:webrtc`, details: { event: match?.[1] ?? "diagnostic" } });
    }
    if (message.type() === "warning" && message.text().includes("[syncwatch-realtime-diagnostic]")) {
      diagnostics.push({ kind: `${name}:realtime-warning`, details: { message: "Realtime diagnostic warning" } });
    }
  });
  page.on("pageerror", (error) => diagnostics.push({ kind: `${name}:page-error`, details: { message: error.message } }));
  await page.addInitScript(() => {
    const diagnosticWindow = window as Window & { __syncwatchBrowserDiagnostics?: unknown[] };
    const diagnosticPeers: RTCPeerConnection[] = [];
    const diagnosticSenders: RTCRtpSender[] = [];
    (diagnosticWindow as Window & { __syncwatchDiagnosticPeers?: RTCPeerConnection[] }).__syncwatchDiagnosticPeers = diagnosticPeers;
    (diagnosticWindow as Window & { __syncwatchDiagnosticSenders?: RTCRtpSender[] }).__syncwatchDiagnosticSenders = diagnosticSenders;
    diagnosticWindow.__syncwatchBrowserDiagnostics = [];
    const Original = window.RTCPeerConnection;
    if (!Original) return;
    window.RTCPeerConnection = new Proxy(Original, {
      construct(target, argumentsList, newTarget) {
        const peer = Reflect.construct(target, argumentsList, newTarget) as RTCPeerConnection;
        diagnosticPeers.push(peer);
        const record = (kind: string, details: Record<string, unknown> = {}) => {
          diagnosticWindow.__syncwatchBrowserDiagnostics?.push({ kind, details: {
            signalingState: peer.signalingState,
            iceConnectionState: peer.iceConnectionState,
            connectionState: peer.connectionState,
            ...details,
          } });
        };
        for (const state of ["signalingstatechange", "iceconnectionstatechange", "connectionstatechange"] as const) {
          peer.addEventListener(state, () => record(state));
        }
        peer.addEventListener("icecandidate", (event) => {
          record("icecandidate", { candidatePresent: Boolean(event.candidate) });
        });
        peer.addEventListener("track", (event) => record("track", { trackKind: event.track.kind, trackReadyState: event.track.readyState }));
        const originalAddTrack = peer.addTrack.bind(peer);
        peer.addTrack = ((track: MediaStreamTrack, ...streams: MediaStream[]) => {
          const sender = originalAddTrack(track, ...streams);
          diagnosticSenders.push(sender);
          record("sender-track-added", { trackKind: track.kind, trackReadyState: track.readyState });
          return sender;
        }) as typeof peer.addTrack;
        const originalSetLocalDescription = peer.setLocalDescription.bind(peer);
        peer.setLocalDescription = (async (description?: RTCSessionDescriptionInit) => {
          await originalSetLocalDescription(description);
          record("local-description-set", { descriptionType: peer.localDescription?.type ?? null });
        }) as typeof peer.setLocalDescription;
        const originalSetRemoteDescription = peer.setRemoteDescription.bind(peer);
        peer.setRemoteDescription = (async (description: RTCSessionDescriptionInit) => {
          await originalSetRemoteDescription(description);
          record("remote-description-set", { descriptionType: peer.remoteDescription?.type ?? null });
        }) as typeof peer.setRemoteDescription;
        return peer;
      },
    });
  });
}

test("headed real screen-capture diagnostic", async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    ignoreHTTPSErrors: false,
  });
  await context.addInitScript(() => localStorage.setItem("syncwatch.uiLocale", "en"));
  const diagnostics: BrowserDiagnostic[] = [];
  const host = await context.newPage();
  const viewer = await context.newPage();
  await installDiagnostics(host, "host", diagnostics);
  await installDiagnostics(viewer, "viewer", diagnostics);

  try {
    await Promise.all([
      host.goto("http://localhost:3001/?lang=en", { waitUntil: "domcontentloaded" }),
      viewer.goto("http://localhost:3001/?lang=en", { waitUntil: "domcontentloaded" }),
    ]);
    await Promise.all([host.getByLabel("Display name").waitFor(), viewer.getByLabel("Display name").waitFor()]);
    await host.getByLabel("Display name").fill("Browser Host");
    await host.getByRole("button", { name: "Create a new lobby" }).click();
    await expect(host.getByText("Host", { exact: true })).toBeVisible({ timeout: 30_000 });
    const lobbyCode = new URL(host.url()).pathname.split("/").at(-1);
    expect(lobbyCode, "host lobby code is visible").toBeTruthy();

    await viewer.getByLabel("Display name").fill("Browser Viewer");
    await viewer.locator("#lobby-code").fill(lobbyCode!);
    await viewer.getByRole("button", { name: "Join with code" }).click();
    await expect(viewer.getByText("Viewer", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(host.getByText("Browser Viewer", { exact: true })).toBeVisible({ timeout: 30_000 });

    const presence = await host.locator("body").innerText();
    expect(presence).toContain("Browser Host");
    expect(presence).toContain("Browser Viewer");
    console.log("Presence confirmed: Browser Host and Browser Viewer are in the same lobby.");
    console.log("REAL CAPTURE PAUSE: Click the Host page's Start sharing button, then manually select a screen or tab in the browser's native picker. The diagnostic will automatically collect results after the host preview and viewer media arrive, or after 10 minutes.");

    await host.getByRole("button", { name: "Start sharing" }).click();
    await expect.poll(() => host.locator("video").evaluate((video: HTMLVideoElement) => video.srcObject !== null), { timeout: observationTimeout }).toBe(true);
    await expect.poll(() => viewer.locator("video").evaluate((video: HTMLVideoElement) => video.srcObject !== null), { timeout: 45_000 }).toBe(true);
    await expect.poll(() => viewer.locator("video").evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 45_000 }).toBeGreaterThan(0);

    const pages = { host, viewer };
    const browserDiagnostics = await Promise.all(Object.entries(pages).map(async ([name, page]) => {
      const data = await page.evaluate(() => {
        const values = (window as Window & { __syncwatchBrowserDiagnostics?: unknown[] }).__syncwatchBrowserDiagnostics ?? [];
        const video = document.querySelector("video");
        const events = values.filter((value): value is { kind: string; details: Record<string, unknown> } =>
          typeof value === "object" && value !== null && "kind" in value && "details" in value,
        );
        const peers = (window as Window & { __syncwatchDiagnosticPeers?: RTCPeerConnection[] }).__syncwatchDiagnosticPeers ?? [];
        const senders = (window as Window & { __syncwatchDiagnosticSenders?: RTCRtpSender[] }).__syncwatchDiagnosticSenders ?? [];
        return {
          negotiation: {
            offerSet: events.some((event) => event.kind === "local-description-set" && event.details.descriptionType === "offer"),
            answerSet: events.some((event) => event.kind === "local-description-set" && event.details.descriptionType === "answer") || events.some((event) => event.kind === "remote-description-set" && event.details.descriptionType === "answer"),
            trackEvents: events.filter((event) => event.kind === "track").map((event) => event.details),
            stateChanges: events.filter((event) => event.kind.endsWith("statechange")).map((event) => ({ kind: event.kind, ...event.details })),
            iceCandidateEvents: events.filter((event) => event.kind === "icecandidate").map((event) => ({ candidatePresent: event.details.candidatePresent })),
          },
          peerConnections: peers.map((peer) => ({ signalingState: peer.signalingState, iceConnectionState: peer.iceConnectionState, connectionState: peer.connectionState })),
          senderVideoTracks: senders.map((sender) => ({
            trackKind: sender.track?.kind ?? null,
            readyState: sender.track?.readyState ?? null,
            settings: sender.track?.getSettings() ?? null,
          })),
          video: video ? {
            hasSrcObject: video.srcObject !== null,
            readyState: video.readyState,
            width: video.videoWidth,
            height: video.videoHeight,
            paused: video.paused,
            playbackError: video.error ? { code: video.error.code, message: video.error.message } : null,
          } : null,
        };
      });
      return [name, data] as const;
    }));
    const hostCapture = await host.evaluate(() => {
      const video = document.querySelector("video");
      const stream = video?.srcObject;
      const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
      return track ? { readyState: track.readyState, settings: track.getSettings() } : null;
    });
    console.log(JSON.stringify({
      lobbyCode,
      captureMethod: "native getDisplayMedia via application Start sharing button",
      fakeMediaFlags: false,
      presence: ["Browser Host", "Browser Viewer"],
      hostCapture,
      pages: Object.fromEntries(browserDiagnostics),
      browserConsoleErrors: diagnostics.filter((entry) => entry.kind.endsWith(":console-error") || entry.kind.endsWith(":page-error")),
      applicationWebRtcEvents: diagnostics.filter((entry) => entry.kind.endsWith(":webrtc")),
    }, null, 2));
  } finally {
    await context.close();
  }
});
