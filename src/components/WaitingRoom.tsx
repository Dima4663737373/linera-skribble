import { useEffect, useState } from "react";
import { Users, Copy, Check, Play, Settings } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useLinera } from "./LineraProvider";
import { FriendsDialog } from "./FriendsDialog";
import { CharacterAvatar } from "./CharacterAvatar";
import { getCharacterIdForPlayer, getCharacterPropsById, getSelectedAvatarJson, parseAvatarJson } from "../utils/characters";

interface WaitingRoomProps {
  hostChainId: string;
  playerName: string;
  isHost: boolean;
  onStartGame: (settings: GameSettings) => void;
  onBackToLobby: () => void;
}

export interface GameSettings {
  totalRounds: number;
  roundTime: number;
}

export function WaitingRoom({ hostChainId, playerName, isHost, onStartGame, onBackToLobby }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const [totalRounds, setTotalRounds] = useState(3);
  const [roundTime, setRoundTime] = useState(80);
  const [players, setPlayers] = useState<{ id: string; name: string; isHost: boolean; avatarJson?: string }[]>([
    { id: "local", name: playerName, isHost, avatarJson: getSelectedAvatarJson() },
  ]);
  const { application, client, ready, chainId } = useLinera();

  const handleCopyChainId = async () => {
    try {
      await navigator.clipboard.writeText(hostChainId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {}
  };

  const handleStartGame = async () => {
    if (!application || !ready) return;
    try {
      await application.query('{ "query": "mutation { startGame(rounds: ' + totalRounds + ', secondsPerRound: ' + roundTime + ') }" }');
    } catch {}
    onStartGame({ totalRounds, roundTime });
  };

  const handleInviteFriend = async (friendChainId: string) => {
    if (!application) return;
    const escapeGqlString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    const friend = escapeGqlString(friendChainId);
    await application.query(JSON.stringify({ query: `mutation { inviteFriend(friendChainId: "${friend}") }` }));
  };

  useEffect(() => {
    if (!client || !application || !ready) return;

    let inFlight = false;
    let pending = false;

    const poll = async () => {
      if (inFlight) {
        pending = true;
        return;
      }

      inFlight = true;
      try {
        try {
          const res = await application.query(
            '{ "query": "query { room { hostChainId gameState totalRounds secondsPerRound players { chainId name avatarJson } } }" }'
          );
          const json = typeof res === 'string' ? JSON.parse(res) : res;
          const data = json?.data?.room;
          if (!data) {
            return;
          }
          if (data.players) {
            const list = data.players.map((p: any) => ({ id: p.chainId, name: p.name, isHost: p.chainId === hostChainId, avatarJson: p.avatarJson }));
            const merged = list.length ? list : [{ id: "local", name: playerName, isHost: isHost }];
            setPlayers(merged);
          }
          if (
            data.gameState &&
            [
              "ChoosingDrawer",
              "WaitingForWord",
              "Drawing",
              "CHOOSING_DRAWER",
              "WAITING_FOR_WORD",
              "DRAWING",
            ].includes(data.gameState)
          ) {
            const settings = { totalRounds: data.totalRounds ?? totalRounds, roundTime: data.secondsPerRound ?? roundTime };
            onStartGame(settings);
          }
        } catch {}
      } finally {
        inFlight = false;
        if (pending) {
          pending = false;
          poll();
        }
      }
    };

    const handleNotification = () => {
      poll();
    };

    const unsubscribe = (client as any).onNotification?.(handleNotification);

    poll();

    return () => {
      if (typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch {}
      } else {
        try { (client as any).offNotification?.(handleNotification); } catch {}
      }
    };
  }, [client, application, ready, hostChainId, playerName, isHost, totalRounds, roundTime]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-4xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-black rounded-2xl mb-4">
            <Users className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-black text-4xl">SKRIBBL</h1>
          <p className="text-black/60">Waiting for players...</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Players List */}
          <div className="bg-white border-2 border-black rounded-lg overflow-hidden">
            <div className="bg-black text-white px-4 py-3 flex items-center justify-between">
              <h2>Players ({players.length})</h2>
              <Users className="w-5 h-5" />
            </div>
            <div className="divide-y-2 divide-black">
              {players.map((player) => (
                <div key={player.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <CharacterAvatar
                      props={parseAvatarJson(player.avatarJson || "") || getCharacterPropsById(getCharacterIdForPlayer(player.id, chainId || ""))}
                      className="w-10 h-10 flex items-center justify-center"
                    />
                    <span className="truncate">{player.name}</span>
                  </div>
                  {player.isHost && (
                    <span className="text-xs bg-red-500 text-white px-2 py-1 rounded">HOST</span>
                  )}
                </div>
              ))}
            </div>

            {/* Chain ID */}
            <div className="p-4 border-t-2 border-black bg-black/5">
              <Label className="text-black/60 text-xs mb-2 block">Host Chain ID</Label>
              <div className="flex gap-2">
                <Input
                  value={hostChainId}
                  readOnly
                  className="border-2 border-gray-400 bg-white flex-1"
                />
                <Button
                  onClick={handleCopyChainId}
                  variant="outline"
                  className="border-2 border-gray-400 hover:bg-black hover:text-white"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-black/60 mt-2 mb-3">
                Share this ID with your friends to join
              </p>
              
              {isHost && (
                <div className="flex justify-center mt-2">
                  <FriendsDialog 
                    currentChainId={hostChainId} 
                    onInviteToGame={handleInviteFriend} 
                    gameMode={true} 
                  />
                </div>
              )}
            </div>
          </div>

          {/* Game Settings */}
          <div className="bg-white border-2 border-black rounded-lg overflow-hidden h-fit">
            <div className="bg-black text-white px-4 py-3 flex items-center justify-between">
              <h2>Game Settings</h2>
              <Settings className="w-5 h-5" />
            </div>

            <div className="p-4 space-y-4">
              {/* Total Rounds */}
              <div className="space-y-2">
                <Label htmlFor="totalRounds" className="text-black">
                  Total Rounds
                </Label>
                <Input
                  id="totalRounds"
                  type="number"
                  min="1"
                  max="10"
                  value={totalRounds}
                  onChange={(e) => setTotalRounds(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  disabled={!isHost}
                  className="border-2 border-gray-400"
                />
                <p className="text-xs text-black/60">
                  Each player will draw {totalRounds} time{totalRounds !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Round Time */}
              <div className="space-y-2">
                <Label htmlFor="roundTime" className="text-black">
                  Round Time (seconds)
                </Label>
                <Input
                  id="roundTime"
                  type="number"
                  min="30"
                  max="180"
                  step="10"
                  value={roundTime}
                  onChange={(e) => setRoundTime(Math.max(30, Math.min(180, parseInt(e.target.value) || 80)))}
                  disabled={!isHost}
                  className="border-2 border-gray-400"
                />
                <p className="text-xs text-black/60">
                  Time limit for each drawing round
                </p>
              </div>

              {isHost ? (
                <Button
                  onClick={handleStartGame}
                  className="w-full h-12 bg-red-500 hover:bg-red-600 border-2 border-gray-400 text-white mt-4"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Start Game
                </Button>
              ) : (
                <div className="text-center text-sm text-black/60 py-4 border-2 border-gray-400 rounded-lg mt-4">
                  Waiting for host to start the game...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
