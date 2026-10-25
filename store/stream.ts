import { create } from "zustand";
import type { StreamSession, StreamSnapshot } from "../lib/webrtc/session";

interface StreamState extends StreamSnapshot { bind(session: StreamSession): () => void; reset(): void }
const initial: StreamSnapshot = { status: "idle", sessionId: null, role: "none", failure: null };
export const useStreamStore = create<StreamState>((set) => ({ ...initial, bind(session) { set(session.getSnapshot()); return session.subscribe((snapshot) => set(snapshot)); }, reset() { set(initial); } }));
