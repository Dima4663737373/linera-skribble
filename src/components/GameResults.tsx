import { Crown, Medal, Home, Trophy, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { useLinera } from "./LineraProvider";

interface PlayerResult {
  id: string;
  name: string;
  score: number;
}

interface GameResultsProps {
  players: PlayerResult[];
  onBackToLobby: () => void;
  onPlayAgain: () => void;
}

export function GameResults({ players, onBackToLobby, onPlayAgain }: GameResultsProps) {
  const { application, ready } = useLinera();
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const winner = sortedPlayers[0];

  const getMedalIcon = (position: number) => {
    if (position === 0) return <Trophy className="w-8 h-8 text-red-500" />;
    if (position === 1) return <Medal className="w-8 h-8 text-black/60" />;
    if (position === 2) return <Medal className="w-8 h-8 text-black/40" />;
    return null;
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-red-500 rounded-2xl mb-4 animate-bounce">
            <Crown className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-black text-5xl">Game Over!</h1>
          <p className="text-black/60 text-xl">
            {winner.name} wins with {winner.score} points!
          </p>
        </div>

        {/* Results */}
        <div className="bg-white border-2 border-black rounded-lg overflow-hidden">
          <div className="bg-black text-white px-6 py-4">
            <h2 className="text-2xl">Final Scores</h2>
          </div>

          <div className="divide-y-2 divide-black">
            {sortedPlayers.map((player, index) => (
              <div
                key={player.id}
                className={`px-6 py-4 flex items-center gap-4 ${
                  index === 0 ? "bg-red-500/10" : ""
                }`}
              >
                <div className="w-12 flex justify-center">
                  {getMedalIcon(index) || (
                    <span className="text-xl text-black/40">#{index + 1}</span>
                  )}
                </div>

                <div className="flex-1">
                  <div className="text-xl">{player.name}</div>
                </div>

                <div className="text-2xl tabular-nums">
                  {player.score}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-4">
          <Button
            onClick={onPlayAgain}
            className="h-14 bg-black text-white hover:bg-black/80 text-lg"
          >
            <RotateCcw className="w-5 h-5 mr-2" />
            Play Again
          </Button>

          <Button
            onClick={async () => {
              if (application && ready) {
                try {
                  await application.query('{ "query": "mutation { leaveRoom }" }');
                } catch {}
              }
              onBackToLobby();
            }}
            variant="outline"
            className="h-14 border-2 border-black hover:bg-black hover:text-white text-lg"
          >
            <Home className="w-5 h-5 mr-2" />
            Back to Lobby
          </Button>
        </div>

        {/* Fun Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white border-2 border-black rounded-lg p-4 text-center">
            <div className="text-3xl">🎨</div>
            <div className="text-sm text-black/60 mt-2">Total Drawings</div>
            <div className="text-xl mt-1">{sortedPlayers.length * 3}</div>
          </div>

          <div className="bg-white border-2 border-black rounded-lg p-4 text-center">
            <div className="text-3xl">⚡</div>
            <div className="text-sm text-black/60 mt-2">Highest Score</div>
            <div className="text-xl mt-1">{winner.score}</div>
          </div>

          <div className="bg-white border-2 border-black rounded-lg p-4 text-center">
            <div className="text-3xl">👥</div>
            <div className="text-sm text-black/60 mt-2">Total Players</div>
            <div className="text-xl mt-1">{sortedPlayers.length}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
