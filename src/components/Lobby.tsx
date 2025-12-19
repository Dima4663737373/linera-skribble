import { useState, useEffect } from "react";
import { Users, Plus, LogIn, Loader2, KeyRound } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useLinera } from "./LineraProvider";
import { HistoryView } from "./HistoryView";
import type { HistoryItem } from "./HistoryDetailModal";

interface LobbyProps {
  onJoinGame: (playerName: string, hostChainId: string, isHost: boolean, userId: number) => void;
}

export function Lobby({ onJoinGame }: LobbyProps) {
  const [playerName, setPlayerName] = useState(""); // nickname
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [showJoinInput, setShowJoinInput] = useState(false);
  const [hostChainId, setHostChainId] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [errorMsg, setErrorMsg] = useState("");

  const [showHistory, setShowHistory] = useState(false);
  const [preloadedHistory, setPreloadedHistory] = useState<HistoryItem[]>([]);
  const [historyPreloading, setHistoryPreloading] = useState(false);

  const { application, chainId, ready } = useLinera();

  // Auto-login on mount
  useEffect(() => {
    const savedNick = localStorage.getItem('skribbl_nickname');
    const savedPass = localStorage.getItem('skribbl_password');
    if (savedNick && savedPass) {
      setPlayerName(savedNick);
      setPassword(savedPass);
      handleAuth(savedNick, savedPass);
    }
  }, []);

  // Pre-load history when logged in and application is ready
  useEffect(() => {
    if (isLoggedIn && application && ready && playerName && preloadedHistory.length === 0 && !historyPreloading) {
      console.log("[History] Auto-loading history for logged in user:", playerName);
      setTimeout(() => preloadHistory(playerName), 100);
    }
  }, [isLoggedIn, application, ready, playerName]);

  // Pre-load history in background
  const preloadHistory = async (nick: string) => {
    if (!application || historyPreloading) return;

    setHistoryPreloading(true);
    console.log("[History Preload] Starting background fetch for:", nick);

    const wsUrl = (import.meta as any).env?.VITE_DRAWING_SERVER_WS_URL || 'wss://skribbl-linera.xyz/ws';
    const finalUrl = wsUrl.includes('wss://skribbl-linera.xyz/ws') && window.location.hostname === 'localhost'
      ? 'ws://localhost:8070'
      : wsUrl.replace('wss://', 'ws://');

    try {
      const ws = new WebSocket(finalUrl);
      await new Promise<void>((resolve) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'get_history', nickname: nick }));
        };
        ws.onmessage = async (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'history_result') {
            try {
              const images: HistoryItem[] = [];
              for (const item of msg.history) {
                const query = `{ "query": "query { dataBlob(hash: \\"${item.blob_hash}\\") }" }`;
                try {
                  const res = await application?.query(query);
                  if (res) {
                    const json = JSON.parse(res);
                    const bytes = json.data?.dataBlob;
                    if (bytes && Array.isArray(bytes)) {
                      const uint8 = new Uint8Array(bytes);
                      let imageUrl = "";
                      let meta = undefined;

                      try {
                        const text = new TextDecoder().decode(uint8);
                        const payload = JSON.parse(text);
                        if (payload.image && payload.meta) {
                          imageUrl = payload.image;
                          meta = payload.meta;
                        } else {
                          throw new Error("Not enriched blob");
                        }
                      } catch (e) {
                        const blob = new Blob([uint8], { type: 'image/png' });
                        imageUrl = URL.createObjectURL(blob);
                      }

                      images.push({
                        blobHash: item.blob_hash,
                        timestamp: item.timestamp,
                        url: imageUrl,
                        roomId: item.room_id,
                        meta: meta
                      });
                    }
                  }
                } catch (e) {
                  console.error("[History Preload] Failed to fetch blob:", item.blob_hash, e);
                }
              }
              setPreloadedHistory(images);
              console.log(`[History Preload] Loaded ${images.length} drawings`);
            } catch (e) {
              console.error("[History Preload] Processing error:", e);
            }
            resolve();
            ws.close();
          }
        };
        ws.onerror = () => { ws.close(); resolve(); };
        setTimeout(() => { ws.close(); resolve(); }, 10000); // 10s timeout
      });
    } catch (e) {
      console.error("[History Preload] Error:", e);
    } finally {
      setHistoryPreloading(false);
    }
  };

  const handleAuth = async (nickOverride?: string, passOverride?: string) => {
    const nick = nickOverride || playerName;
    const pass = passOverride || password;

    if (!nick.trim() || !pass.trim()) return;
    setIsProcessing(true);
    setErrorMsg("");

    // Temporary WS connection for auth
    const wsUrl = (import.meta as any).env?.VITE_DRAWING_SERVER_WS_URL || 'wss://skribbl-linera.xyz/ws';
    // Fallback to localhost if env not set for dev
    const finalUrl = wsUrl.includes('wss://skribbl-linera.xyz/ws') && window.location.hostname === 'localhost'
      ? 'ws://localhost:8070'
      : wsUrl.replace('wss://', 'ws://'); // Simplified dev logic, ideally use env

    try {
      const ws = new WebSocket(finalUrl);

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: authMode,
            nickname: nick.trim(),
            password: pass.trim()
          }));
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'auth_success') {
              setUserId(msg.userId);
              setIsLoggedIn(true);
              // Persist credentials
              localStorage.setItem('skribbl_nickname', nick.trim());
              localStorage.setItem('skribbl_password', pass.trim());
              // Pre-load history in background
              setTimeout(() => preloadHistory(nick.trim()), 100); // Small delay to ensure application is ready
              resolve();
              ws.close();
            } else if (msg.type === 'auth_error') {
              if (!nickOverride) {
                // Only show error if manual attempt, silent fail for auto-login
                setErrorMsg(msg.message);
              }
              reject(msg.message);
              ws.close();
            }
          } catch (e) { reject(e); }
        };

        ws.onerror = (e) => reject("Connection error");

        // Timeout
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.close();
          reject("Timeout");
        }, 5000);
      });
    } catch (e: any) {
      if (!nickOverride) {
        setErrorMsg(typeof e === 'string' ? e : "Authentication failed");
      }
    } finally {
      setIsProcessing(false);
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
    if (!playerName.trim() || !application || !ready || !userId) return;
    setIsProcessing(true);
    try {
      await application.query('{ "query": "mutation { createRoom(hostName: \\\"' + playerName.trim() + '\\\" ) }" }');
      onJoinGame(playerName.trim(), chainId || '', true, userId);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim() || !hostChainId.trim() || !application || !ready || !userId) return;
    setIsProcessing(true);
    try {
      const hostId = hostChainId.trim();
      await application.query('{ "query": "mutation { joinRoom(hostChainId: \\\"' + hostId + '\\\", playerName: \\\"' + playerName.trim() + '\\\") }" }');
      onJoinGame(playerName.trim(), hostId, false, userId);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  // Auth Screen
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-black rounded-2xl mb-4">
              <Users className="w-10 h-10 text-red-500" />
            </div>
            <h1 className="text-black text-4xl">SKRIBBL</h1>
            <p className="text-black/60">{authMode === 'login' ? 'Login to play' : 'Create an account'}</p>
          </div>

          <div className="bg-white border-2 border-black rounded-lg p-6 space-y-6">
            <div className="space-y-2">
              <Label>Nickname</Label>
              <Input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="Username" maxLength={20} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
            </div>

            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}

            <Button onClick={() => handleAuth()} disabled={isProcessing} className="w-full h-12 bg-red-500 hover:bg-red-600 text-white">
              {isProcessing ? <Loader2 className="animate-spin" /> : <KeyRound className="mr-2 w-4 h-4" />}
              {authMode === 'login' ? 'Login' : 'Register'}
            </Button>

            <div className="text-center mt-4">
              <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-sm underline">
                {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // History View (Refactored)
  if (showHistory) {
    return <HistoryView onClose={() => setShowHistory(false)} playerName={playerName} application={application} preloadedData={preloadedHistory} />;
  }

  // Lobby Screen (Authenticated)
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-black rounded-2xl mb-4">
            <Users className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-black text-4xl">SKRIBBL</h1>
          <p className="text-black/60">Welcome, {playerName}!</p>
        </div>

        {/* Main Card */}
        <div className="bg-white border-2 border-black rounded-lg p-6 space-y-6">
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
                  disabled={!ready || isProcessing}
                  className="w-full h-12 bg-red-500 hover:bg-red-600 border-2 border-gray-400 text-white"
                >
                  {isProcessing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
                  {isProcessing ? "Creating..." : "Create Room"}
                </Button>

                <Button
                  onClick={() => setShowJoinInput(true)}
                  disabled={!ready || isProcessing}
                  variant="outline"
                  className="w-full h-12 border-2 border-gray-400 hover:bg-black hover:text-white"
                >
                  <LogIn className="w-5 h-5 mr-2" />
                  Join Room
                </Button>

                <Button
                  onClick={() => {
                    setShowHistory(true);
                  }}
                  variant="ghost"
                  className="w-full text-gray-500 hover:text-black"
                >
                  View History
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleJoinRoom}
                  disabled={!hostChainId.trim() || !ready || isProcessing}
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
  );
}
