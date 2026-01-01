import { useState } from "react";
import { Game, Player } from "./components/Game";
import { Lobby } from "./components/Lobby";
import { WaitingRoom, GameSettings } from "./components/WaitingRoom";
import { GameResults } from "./components/GameResults";
import { GlobalDebugOverlay } from "./components/GlobalDebugOverlay";
import { useLinera } from "./components/LineraProvider";

type AppState =
  | { screen: "lobby" }
  | { screen: "waiting"; playerName: string; hostChainId: string; isHost: boolean }
  | { screen: "game"; playerName: string; hostChainId: string; settings: GameSettings }
  | { screen: "results"; players: Player[]; blobHashes: string[]; settings: GameSettings; playerName: string; hostChainId: string };

export default function App() {
  const [appState, setAppState] = useState<AppState>({ screen: "lobby" });
  const { application, client, ready, chainId } = useLinera();

  const handleJoinGame = (playerName: string, hostChainId: string, isHost: boolean) => {
    setAppState({
      screen: "waiting",
      playerName,
      hostChainId,
      isHost,
    });
  };

  const handleStartGame = (settings: GameSettings) => {
    if (appState.screen !== "waiting") return;
    setAppState({
      screen: "game",
      playerName: appState.playerName,
      hostChainId: appState.hostChainId,
      settings,
    });
  };

  const handleGameEnd = (players: Player[], blobHashes: string[]) => {
    if (appState.screen !== "game") return;
    setAppState({
      screen: "results",
      players,
      blobHashes,
      settings: appState.settings,
      playerName: appState.playerName,
      hostChainId: appState.hostChainId,
    });
  };

  const handlePlayAgain = () => {
    if (appState.screen !== "results") return;
    setAppState({
      screen: "waiting",
      playerName: appState.playerName,
      hostChainId: appState.hostChainId,
      isHost: appState.hostChainId === chainId,
    });
  };

  const handleBackToLobby = () => {
    setAppState({ screen: "lobby" });
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
          blobHashes={appState.blobHashes}
          hostChainId={appState.hostChainId}
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
        settings={appState.settings}
        onGameEnd={handleGameEnd}
        onBackToLobby={handleBackToLobby}
      />
      <GlobalDebugOverlay application={application} client={client} ready={ready} />
    </div>
  );
}
