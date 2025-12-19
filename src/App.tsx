import { useState } from "react";
import { Game, Player } from "./components/Game";
import { Lobby } from "./components/Lobby";
import { WaitingRoom, GameSettings } from "./components/WaitingRoom";
import { GameResults } from "./components/GameResults";
import { GlobalDebugOverlay } from "./components/GlobalDebugOverlay";
import { useLinera } from "./components/LineraProvider";

type AppState =
  | { screen: "lobby" }
  | { screen: "waiting"; playerName: string; hostChainId: string; isHost: boolean; userId?: number }
  | { screen: "game"; playerName: string; hostChainId: string; settings: GameSettings; userId?: number }
  | { screen: "results"; players: Player[]; settings: GameSettings; playerName: string; hostChainId: string; userId?: number };

export default function App() {
  const [appState, setAppState] = useState<AppState>({ screen: "lobby" });
  const { application, client, ready, chainId } = useLinera();

  const handleJoinGame = (playerName: string, hostChainId: string, isHost: boolean, userId?: number) => {
    setAppState({
      screen: "waiting",
      playerName,
      hostChainId,
      isHost,
      userId,
    });
  };

  const handleStartGame = (settings: GameSettings) => {
    if (appState.screen !== "waiting") return;
    setAppState({
      screen: "game",
      playerName: appState.playerName,
      hostChainId: appState.hostChainId,
      settings,
      userId: appState.userId,
    });
  };

  const handleGameEnd = (players: Player[]) => {
    if (appState.screen !== "game") return;
    setAppState({
      screen: "results",
      players,
      settings: appState.settings,
      playerName: appState.playerName,
      hostChainId: appState.hostChainId,
      userId: appState.userId
    });
  };

  const handlePlayAgain = () => {
    if (appState.screen !== "results") return;
    setAppState({
      screen: "waiting",
      playerName: appState.playerName,
      hostChainId: appState.hostChainId,
      isHost: appState.hostChainId === chainId,
      userId: appState.userId,
    });
  };

  const handleBackToLobby = () => {
    try { localStorage.removeItem('linera_mnemonic'); } catch { }
    window.location.reload();
  };

  if (appState.screen === "lobby") {
    return (
      <>
        <Lobby onJoinGame={handleJoinGame} />
        <GlobalDebugOverlay application={application} client={client} ready={ready} />
      </>
    );
  }

  if (appState.screen === "waiting") {
    return (
      <>
        <WaitingRoom
          hostChainId={appState.hostChainId}
          playerName={appState.playerName}
          isHost={appState.isHost}
          onStartGame={handleStartGame}
          onBackToLobby={handleBackToLobby}
        />
        <GlobalDebugOverlay application={application} client={client} ready={ready} />
      </>
    );
  }

  if (appState.screen === "results") {
    return (
      <>
        <GameResults
          players={appState.players}
          onPlayAgain={handlePlayAgain}
          onBackToLobby={handleBackToLobby}
        />
        <GlobalDebugOverlay application={application} client={client} ready={ready} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Game
        playerName={appState.playerName}
        hostChainId={appState.hostChainId}
        userId={appState.userId}
        settings={appState.settings}
        onGameEnd={handleGameEnd}
        onBackToLobby={handleBackToLobby}
      />
      <GlobalDebugOverlay application={application} client={client} ready={ready} />
    </div>
  );
}
