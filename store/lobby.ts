import { create } from "zustand";
import type { LobbySession, LobbySessionSnapshot } from "../lib/realtime/session";

interface LobbyState extends LobbySessionSnapshot {
  bind(session: LobbySession): () => void;
  reset(): void;
}

const initialSnapshot: LobbySessionSnapshot = {
  status: "idle", code: null, members: [], selfMemberId: null, hostMemberId: null, error: null, presenceStatus: "current",
};

export const useLobbyStore = create<LobbyState>((set) => ({
  ...initialSnapshot,
  bind(session) {
    set(session.getSnapshot());
    const unsubscribe = session.subscribe((snapshot) => set(snapshot));
    return unsubscribe;
  },
  reset() {
    set(initialSnapshot);
  },
}));
