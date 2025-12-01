import { useState } from "react";
import { Users, Plus, LogIn, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useLinera } from "./LineraProvider";

interface LobbyProps {
  onJoinGame: (playerName: string, hostChainId: string, isHost: boolean) => void;
}

export function Lobby({ onJoinGame }: LobbyProps) {
  const [playerName, setPlayerName] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [hostChainId, setHostChainId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const { application, chainId, ready } = useLinera();

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-black rounded-2xl mb-4">
            <Users className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-black text-4xl">SKRIBBL</h1>
          <div className="flex flex-col items-center justify-center gap-2 text-black/60">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p>Initializing Wallet...</p>
          </div>
        </div>
      </div>
    );
  }

  const handleCreateRoom = async () => {
    if (!playerName.trim() || !application || !ready) return;
    setIsCreating(true);
    try {
      await application.query('{ "query": "mutation { createRoom(hostName: \\\"' + playerName.trim() + '\\\" ) }" }');
      onJoinGame(playerName.trim(), chainId || '', true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim() || !hostChainId.trim() || !application || !ready) return;
    setIsJoining(true);
    try {
      const hostId = hostChainId.trim();
      await application.query('{ "query": "mutation { joinRoom(hostChainId: \\\"' + hostId + '\\\", playerName: \\\"' + playerName.trim() + '\\\") }" }');
      onJoinGame(playerName.trim(), hostId, false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-black rounded-2xl mb-4">
            <Users className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-black text-4xl">SKRIBBL</h1>
          <p className="text-black/60">Draw, guess, and win!</p>
        </div>

        {/* Main Card */}
        <div className="bg-white border-2 border-black rounded-lg p-6 space-y-6">
          {/* Name Input */}
          <div className="space-y-2">
            <Label htmlFor="playerName" className="text-black">
              Your Name
            </Label>
            <Input
              id="playerName"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="border-2 border-gray-400 h-12"
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !showJoinInput) {
                  handleCreateRoom();
                }
              }}
            />
          </div>

          {/* Join Room Input (conditional) */}
          {showJoinInput && (
            <div className="space-y-2 animate-in slide-in-from-top-2">
              <Label htmlFor="hostChainId" className="text-black">
                Host Chain ID
              </Label>
                <Input
                  id="hostChainId"
                  value={hostChainId}
                  onChange={(e) => setHostChainId(e.target.value)}
                  placeholder="Enter host chain ID"
                  className="border-2 border-gray-400 h-12"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleJoinRoom();
                    }
                  }}
                />
            </div>
          )}

          {/* Buttons */}
          <div className="space-y-3 pt-2">
            {!showJoinInput ? (
              <>
                <Button
                  onClick={handleCreateRoom}
                  disabled={!playerName.trim() || !ready || isCreating}
                  className="w-full h-12 bg-red-500 hover:bg-red-600 border-2 border-gray-400 text-white"
                >
                  {isCreating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
                  {isCreating ? "Creating..." : "Create Room"}
                </Button>

                <Button
                  onClick={() => setShowJoinInput(true)}
                  disabled={!playerName.trim() || !ready || isCreating}
                  variant="outline"
                  className="w-full h-12 border-2 border-gray-400 hover:bg-black hover:text-white"
                >
                  <LogIn className="w-5 h-5 mr-2" />
                  Join Room
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleJoinRoom}
                  disabled={!playerName.trim() || !hostChainId.trim() || !ready || isJoining}
                  className="w-full h-12 bg-red-500 hover:bg-red-600 border-2 border-gray-400 text-white"
                >
                  {isJoining ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <LogIn className="w-5 h-5 mr-2" />}
                  {isJoining ? "Joining..." : "Join"}
                </Button>

                <Button
                  onClick={() => {
                    setShowJoinInput(false);
                    setHostChainId("");
                  }}
                  variant="outline"
                  className="w-full h-12 border-2 border-gray-400 hover:bg-black hover:text-white"
                >
                  Back
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="text-center text-sm text-black/60 space-y-1">
          <p>Invite your friends and play together!</p>
          <p>Create a room and share the chain ID with other players</p>
        </div>
      </div>
    </div>
  );
}
