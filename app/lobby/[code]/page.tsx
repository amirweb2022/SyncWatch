export default async function LobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // TODO: Build the lobby experience.
  return <main className="min-h-screen p-6">Lobby {code}</main>;
}
