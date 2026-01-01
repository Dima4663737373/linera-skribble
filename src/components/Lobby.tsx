import { useState, useEffect } from "react";
import { Users, Plus, LogIn, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useLinera } from "./LineraProvider";
import { HistoryView } from "./HistoryView";
import { FriendsDialog } from "./FriendsDialog";
import type { HistoryItem } from "./HistoryDetailModal";
import { CharacterAvatar } from "./CharacterAvatar";
import type { AvatarProps } from "@bigheads/core";
import {
  CHARACTER_PRESETS,
  CUSTOM_CHARACTER_ID,
  generateRandomCharacterProps,
  getCharacterPropsById,
  getSelectedAvatarJson,
  loadCustomCharacterProps,
  loadSelectedCharacterId,
  saveCustomCharacterProps,
  saveSelectedCharacterId,
} from "../utils/characters";

interface LobbyProps {
  onJoinGame: (playerName: string, hostChainId: string, isHost: boolean) => void;
}

export function Lobby({ onJoinGame }: LobbyProps) {
  const [playerName, setPlayerName] = useState(""); // nickname
  const [characterId, setCharacterId] = useState<string>(() => {
    try {
      return loadSelectedCharacterId();
    } catch {
      return "astro";
    }
  });

  const [showJoinInput, setShowJoinInput] = useState(false);
  const [hostChainId, setHostChainId] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [preloadedHistory, setPreloadedHistory] = useState<HistoryItem[]>([]);
  const [historyPreloading, setHistoryPreloading] = useState(false);
  const [customCharacterProps, setCustomCharacterProps] = useState<AvatarProps | null>(() => {
    try {
      return loadCustomCharacterProps();
    } catch {
      return null;
    }
  });

  const { application, chainId, ready } = useLinera();

  // Load nickname on mount
  useEffect(() => {
    const savedNick = localStorage.getItem('skribbl_nickname');
    if (savedNick) setPlayerName(savedNick);
    try {
      setCharacterId(loadSelectedCharacterId());
    } catch {}
    try {
      setCustomCharacterProps(loadCustomCharacterProps());
    } catch {}
  }, []);

  useEffect(() => {
    const nick = playerName.trim();
    if (nick) {
      localStorage.setItem('skribbl_nickname', nick);
    }
  }, [playerName]);

  useEffect(() => {
    try {
      saveSelectedCharacterId(characterId);
    } catch {}
  }, [characterId]);

  const presetIds = CHARACTER_PRESETS.map((p) => p.id);
  const currentIndexRaw = presetIds.indexOf(characterId);
  const currentIndex = currentIndexRaw >= 0 ? currentIndexRaw : 0;
  const isCustomCharacter = characterId === CUSTOM_CHARACTER_ID;

  const handlePrevCharacter = () => {
    const len = presetIds.length;
    if (!len) return;
    setCharacterId(presetIds[(currentIndex - 1 + len) % len]);
  };

  const handleNextCharacter = () => {
    const len = presetIds.length;
    if (!len) return;
    setCharacterId(presetIds[(currentIndex + 1) % len]);
  };

  const handleGenerateRandomCharacter = () => {
    try {
      const props = generateRandomCharacterProps();
      saveCustomCharacterProps(props);
      setCustomCharacterProps(props);
      setCharacterId(CUSTOM_CHARACTER_ID);
    } catch {}
  };

  // Pre-load history when application is ready
  useEffect(() => {
    if (application && ready && playerName.trim() && preloadedHistory.length === 0 && !historyPreloading) {
      preloadHistory();
    }
  }, [application, ready, playerName]);

  const normalizeTimestamp = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        if (raw.length >= 16) return new Date(Math.floor(n / 1000)).toISOString();
        if (raw.length >= 13) return new Date(n).toISOString();
        return new Date(n * 1000).toISOString();
      }
    }
    const d1 = new Date(raw);
    if (!Number.isNaN(d1.getTime())) return d1.toISOString();
    const d2 = new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
    if (!Number.isNaN(d2.getTime())) return d2.toISOString();
    return new Date().toISOString();
  };

  const normalizeMeta = (meta: any): HistoryItem["meta"] | undefined => {
    if (!meta || typeof meta !== "object") return undefined;
    const round = Number(meta.round);
    const word = typeof meta.word === "string" ? meta.word : "";
    const playersRaw = Array.isArray(meta.players) ? meta.players : [];
    const chatRaw = Array.isArray(meta.chat) ? meta.chat : [];

    const players = playersRaw
      .map((p: any) => ({
        id: String(p?.id ?? p?.chainId ?? ""),
        name: String(p?.name ?? ""),
        score: Number(p?.score ?? 0) || 0,
        avatarJson: typeof p?.avatarJson === "string"
          ? p.avatarJson
          : (typeof p?.avatar_json === "string" ? p.avatar_json : ""),
      }))
      .filter((p: any) => p.id || p.name);

    const chat = chatRaw
      .map((m: any) => ({
        sender: String(m?.sender ?? m?.playerName ?? ""),
        text: String(m?.text ?? m?.message ?? ""),
      }))
      .filter((m: any) => m.sender && m.text);

    if (!Number.isFinite(round) && !word && players.length === 0 && chat.length === 0) return undefined;

    return {
      round: Number.isFinite(round) ? round : 0,
      word,
      players,
      chat,
    };
  };

  // Pre-load history in background using archivedRooms query
  const preloadHistory = async () => {
    if (!application || historyPreloading) return;

    setHistoryPreloading(true);
    try {
      const gql = "query{archivedRooms{roomId,timestamp,blobHashes}}";
      const res = await application.query(JSON.stringify({ query: gql }));
      const json = typeof res === "string" ? JSON.parse(res) : res;
      const rooms: Array<{ roomId: string; blobHashes: string[]; timestamp: string }> = json?.data?.archivedRooms || [];

      const images: HistoryItem[] = [];
      for (const room of rooms) {
        const roomId = room.roomId;
        const roomTs = normalizeTimestamp(room.timestamp);
        const hashes = Array.isArray(room.blobHashes) ? room.blobHashes : [];
        for (const blobHash of hashes) {
          const q = `query{dataBlob(hash:"${String(blobHash).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")}`;
          try {
            const blobRes = await application.query(JSON.stringify({ query: q }));
            const blobJson = typeof blobRes === "string" ? JSON.parse(blobRes) : blobRes;
            const bytes = blobJson?.data?.dataBlob ?? blobJson?.dataBlob;
            if (!bytes || !Array.isArray(bytes)) continue;

            const uint8 = new Uint8Array(bytes);
            let imageUrl = "";
            let meta: HistoryItem["meta"] | undefined = undefined;
            let itemTs = roomTs;

            try {
              const text = new TextDecoder().decode(uint8);
              const payload = JSON.parse(text);
              if (payload?.image) {
                imageUrl = payload.image;
                meta = normalizeMeta(payload?.meta);
                if (payload?.timestamp !== undefined && payload?.timestamp !== null) {
                  itemTs = normalizeTimestamp(payload.timestamp);
                }
              } else {
                throw new Error("not_json_image");
              }
            } catch {
              const blob = new Blob([uint8], { type: "image/png" });
              imageUrl = URL.createObjectURL(blob);
            }

            images.push({
              blobHash,
              timestamp: itemTs,
              url: imageUrl,
              roomId,
              meta,
            });
          } catch (e) {
            console.error("[History Preload] Failed to fetch blob:", blobHash, e);
          }
        }
      }
      images.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setPreloadedHistory(images);
    } catch (e) {
      console.error("[History Preload] Error:", e);
    } finally {
      setHistoryPreloading(false);
    }
  };

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
    const nick = playerName.trim();
    if (!nick || !application || !ready) return;
    setIsProcessing(true);
    try {
      const escapeGqlString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
      const hostName = escapeGqlString(nick);
      const avatarJsonEscaped = escapeGqlString(getSelectedAvatarJson());
      localStorage.setItem('skribbl_nickname', nick);
      await application.query(JSON.stringify({ query: `mutation { createRoom(hostName: "${hostName}", avatarJson: "${avatarJsonEscaped}") }` }));
      onJoinGame(nick, chainId || '', true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoinRoom = async () => {
    const nick = playerName.trim();
    if (!nick || !hostChainId.trim() || !application || !ready) return;
    setIsProcessing(true);
    try {
      const escapeGqlString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
      const hostId = hostChainId.trim();
      const hostChainIdEscaped = escapeGqlString(hostId);
      const playerNameEscaped = escapeGqlString(nick);
      const avatarJsonEscaped = escapeGqlString(getSelectedAvatarJson());
      localStorage.setItem('skribbl_nickname', nick);
      await application.query(JSON.stringify({ query: `mutation { joinRoom(hostChainId: "${hostChainIdEscaped}", playerName: "${playerNameEscaped}", avatarJson: "${avatarJsonEscaped}") }` }));
      onJoinGame(nick, hostId, false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  // History View (Refactored)
  if (showHistory) {
    return <HistoryView onClose={() => setShowHistory(false)} playerName={playerName} application={application} preloadedData={preloadedHistory} />;
  }

  // Lobby Screen
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="w-full border-b border-black/10">
        <div className="mx-auto w-full max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-10 h-10 bg-black rounded-xl">
              <Users className="w-5 h-5 text-red-500" />
            </div>
            <h1 className="text-black text-2xl">SKRIBBL</h1>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowHistory(true)}
              className="h-10 px-3 text-gray-600 hover:text-black"
              disabled={!application}
            >
              View History
            </Button>

            {ready && chainId && playerName.trim() && (
              <FriendsDialog
                currentChainId={chainId}
                onJoinFromInvite={(hostId) => {
                  const nick = playerName.trim();
                  if (!nick) return;
                  localStorage.setItem('skribbl_nickname', nick);
                  onJoinGame(nick, hostId, false);
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white border-2 border-black rounded-lg p-6 space-y-6">
            <div className="space-y-2">
              <Label>Character</Label>
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePrevCharacter}
                  disabled={presetIds.length <= 1}
                  className="h-12 w-16 p-0 border-2 border-gray-400 hover:bg-black hover:text-white"
                  aria-label="Previous character"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>

                <div className="flex-1 flex items-center justify-center">
                  <div className="bg-white w-28 h-28 flex items-center justify-center">
                    <CharacterAvatar
                      props={isCustomCharacter && customCharacterProps ? customCharacterProps : getCharacterPropsById(characterId)}
                      className="w-full h-full"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleNextCharacter}
                  disabled={presetIds.length <= 1}
                  className="h-12 w-16 p-0 border-2 border-gray-400 hover:bg-black hover:text-white"
                  aria-label="Next character"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
              <div className="text-center text-sm text-black/60 tabular-nums">
                {isCustomCharacter ? "Random" : presetIds.length ? `${currentIndex + 1}/${presetIds.length}` : "0/0"}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerateRandomCharacter}
                className="w-full h-11 border-2 border-gray-400 hover:bg-black hover:text-white"
              >
                Generate random
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Nickname</Label>
              <Input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="Username" maxLength={20} className="border-2 border-gray-400 h-12" />
            </div>

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

            <div className="space-y-3 pt-2">
              {!showJoinInput ? (
                <>
                  <Button
                    onClick={handleCreateRoom}
                    disabled={!ready || isProcessing || !playerName.trim()}
                    className="w-full h-12 bg-red-500 hover:bg-red-600 border-2 border-gray-400 text-white"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
                    {isProcessing ? "Creating..." : "Create Room"}
                  </Button>

                  <Button
                    onClick={() => setShowJoinInput(true)}
                    disabled={!ready || isProcessing || !playerName.trim()}
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
                    disabled={!playerName.trim() || !hostChainId.trim() || !ready || isProcessing}
                    className="w-full h-12 bg-red-500 hover:bg-red-600 border-2 border-gray-400 text-white"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <LogIn className="w-5 h-5 mr-2" />}
                    {isProcessing ? "Joining..." : "Join"}
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
        </div>
      </div>
    </div>
  );
}
