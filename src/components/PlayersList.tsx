import { Crown, Pencil } from "lucide-react";
import type { Player } from "./Game";
import { CharacterAvatar } from "./CharacterAvatar";
import { getCharacterIdForPlayer, getCharacterPropsById, parseAvatarJson } from "../utils/characters";

interface PlayersListProps {
  players: Player[];
  localPlayerId: string;
}

export function PlayersList({ players, localPlayerId }: PlayersListProps) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const topPlayer = sortedPlayers[0];

  return (
    <div className="w-64 bg-white border-2 border-black rounded-lg overflow-hidden h-fit">
      <div className="bg-black text-white px-4 py-3">
        <h2>Players</h2>
      </div>

      <div className="divide-y-2 divide-black">
        {sortedPlayers.map((player, index) => (
          <div
            key={player.id}
            className={`px-4 py-3 flex items-center gap-3 ${
              player.isDrawing ? "bg-red-500 text-white" : ""
            } ${player.hasGuessed ? "opacity-60" : ""}`}
          >
            <div className="w-6 text-center">
              {player.id === topPlayer.id && !player.isDrawing && (
                <Crown className="w-4 h-4 text-red-500" />
              )}
              {player.isDrawing && <Pencil className="w-4 h-4" />}
            </div>

            <CharacterAvatar
              props={parseAvatarJson(player.avatarJson || "") || getCharacterPropsById(getCharacterIdForPlayer(player.id, localPlayerId))}
              className="w-10 h-10 flex items-center justify-center"
            />

            <div className="flex-1 min-w-0">
              <div className="truncate">{player.name}</div>
            </div>

            <div className="tabular-nums">
              {player.score}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
