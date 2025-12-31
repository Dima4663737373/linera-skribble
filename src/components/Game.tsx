import { useState, useRef, useEffect } from "react";
import { Canvas, CanvasHandle } from "./Canvas";
import { ChatPanel } from "./ChatPanel";
import { PlayersList } from "./PlayersList";
import { GameHeader } from "./GameHeader";
import { WordSelector } from "./WordSelector";
import { GameSettings } from "./WaitingRoom";
import { useLinera } from "./LineraProvider";

export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawing: boolean;
  hasGuessed: boolean;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  isCorrect?: boolean;
  timestamp: number;
}

const WORDS = [
  "cat", "dog", "house", "tree", "sun", "cloud", "star",
  "flower", "car", "bicycle", "airplane", "ship", "mountain",
  "river", "sea", "forest", "city", "street", "park", "school"
];

const FIXED_WORD_OPTIONS = ["cat", "house", "tree"];

interface GameProps {
  playerName: string;
  hostChainId: string;
  userId?: number;
  settings: GameSettings;
  onGameEnd: (players: Player[]) => void;
  onBackToLobby: () => void;
}

export function Game({ playerName, hostChainId, userId, settings, onGameEnd, onBackToLobby }: GameProps) {
  const { client, application, chainId, ready } = useLinera();

  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentWord, setCurrentWord] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(settings.roundTime);
  const [round, setRound] = useState<number>(1);
  const [showWordSelector, setShowWordSelector] = useState<boolean>(false);
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [canvasData, setCanvasData] = useState<string>("");
  const canvasCompRef = useRef<CanvasHandle | null>(null);

  // Backend room tracking
  const roomRef = useRef<any>(null);
  const autoWordTimeoutRef = useRef<number | null>(null);
  const autoDrawerTimeoutRef = useRef<number | null>(null);
  const autoDrawerScheduleKeyRef = useRef<string | null>(null);
  const autoDrawerFireKeyRef = useRef<string | null>(null);
  const chooseDrawerInFlightRef = useRef(false);
  const blobHashesRef = useRef<string[]>([]); // Store accumulated blob hashes locally
  const historyWsRef = useRef<WebSocket | null>(null); // Dedicated WS for history sync

  const isHost = roomRef.current?.hostChainId === chainId;

  // Track previous drawer index to detect changes
  const prevDrawerIndexRef = useRef<number | null>(null);

  const cleanupRoomSession = () => {
    if (autoWordTimeoutRef.current) {
      clearTimeout(autoWordTimeoutRef.current);
      autoWordTimeoutRef.current = null;
    }
    if (autoDrawerTimeoutRef.current) {
      clearTimeout(autoDrawerTimeoutRef.current);
      autoDrawerTimeoutRef.current = null;
    }
    autoDrawerScheduleKeyRef.current = null;
    autoDrawerFireKeyRef.current = null;
    chooseDrawerInFlightRef.current = false;
    prevDrawerIndexRef.current = null;
    setShowWordSelector(false);
    setWordOptions([]);
    setCanvasData("");
  };

  // Dedicated function to save history via WebSocket (independent of Canvas)
  const saveHistoryToServer = async (hashes: string[], roomId: string, uid: number) => {
    console.log(`[History] Starting save: hashes=${JSON.stringify(hashes)}, roomId=${roomId}, userId=${uid}`);

    const wsUrl = (import.meta as any).env?.VITE_DRAWING_SERVER_WS_URL || 'wss://skribbl-linera.xyz/ws';
    const finalUrl = wsUrl.includes('wss://skribbl-linera.xyz') && window.location.hostname === 'localhost'
      ? 'ws://localhost:8070'
      : wsUrl.replace('wss://', 'ws://');

    console.log(`[History] Connecting to: ${finalUrl}`);

    return new Promise<void>((resolve) => {
      try {
        const ws = new WebSocket(finalUrl);

        ws.onopen = () => {
          console.log(`[History] WebSocket connected, sending save_history...`);
          const payload = {
            type: 'save_history',
            userId: uid,
            roomId: roomId,
            blobHashes: hashes
          };
          console.log(`[History] Sending payload:`, payload);
          ws.send(JSON.stringify(payload));
          console.log(`[History] Message sent, waiting before close...`);
          setTimeout(() => {
            console.log(`[History] Closing WebSocket`);
            ws.close();
            resolve();
          }, 1000); // Increased to 1 second
        };

        ws.onerror = (err) => {
          console.error('[History] WebSocket error:', err);
          ws.close();
          resolve();
        };

        ws.onclose = () => {
          console.log('[History] WebSocket closed');
          resolve();
        };
      } catch (e) {
        console.error('[History] Failed to create WebSocket:', e);
        resolve();
      }
    });
  };

  const queryGameState = async () => {
    if (!application || !ready) return;
    try {
      const roomResponse = await application.query(
        '{ "query": "query { room { hostChainId players { chainId name score hasGuessed } gameState currentRound totalRounds secondsPerRound currentDrawerIndex wordChosenAt drawerChosenAt blobHashes chatMessages { playerName message isCorrectGuess pointsAwarded } } }" }'
      );
      const roomData = JSON.parse(roomResponse);
      const room = roomData.data?.room;
      if (!room) {
        if (roomRef.current) {
          cleanupRoomSession();
          onBackToLobby();
        }
        return;
      }
      if (room) {
        roomRef.current = room;
        // Players mapping
        const mappedPlayers: Player[] = room.players.map((p: any, idx: number) => ({
          id: p.chainId,
          name: p.name,
          score: p.score ?? 0,
          isDrawing: (room.currentDrawerIndex ?? -1) === idx,
          hasGuessed: !!p.hasGuessed,
        }));
        setPlayers(mappedPlayers);
        // No additional host-missing handling; only leave when room becomes null
        // Round and timers
        setRound(room.currentRound ?? 1);
        // Word selection visibility
        const amIDrawer = mappedPlayers[(room.currentDrawerIndex ?? -1)]?.id === chainId;
        const awaitingWord = (room.gameState === 'WaitingForWord' || room.gameState === 'WAITING_FOR_WORD') && room.drawerChosenAt && !room.wordChosenAt;
        setShowWordSelector(Boolean(awaitingWord && amIDrawer));
        if (awaitingWord && amIDrawer && wordOptions.length === 0) {
          setWordOptions(FIXED_WORD_OPTIONS);
        }
        // Messages mapping (last 20)
        // Messages mapping (last 20, keeping all if possible)
        // Note: Contract might truncate, so we take what we get.
        // Ideally we accumulate messages locally if we want full history, 
        // but for now we rely on the backend state.
        const msgs = (room.chatMessages ?? [])
          .filter((m: any) => m && m.playerName && m.message)
          .map((m: any, idx: number) => ({
            id: `${Date.now()}-${idx}`,
            playerId: m.playerName ?? `p-${idx}`,
            playerName: m.playerName ?? 'Player',
            message: m.message ?? '',
            isCorrect: !!m.isCorrectGuess,
            timestamp: Date.now(),
          }));
        setMessages(msgs);
      }
    } catch { }
  };



  // Subscribe to notifications; remove polling
  useEffect(() => {
    if (!client || !application || !ready) return;

    let isQuerying = false;
    let pending = false;

    const runQuery = async () => {
      if (isQuerying) {
        pending = true;
        return;
      }

      isQuerying = true;
      try {
        await queryGameState();

        const room = roomRef.current;
        if (room && room.blobHashes && room.blobHashes.length > blobHashesRef.current.length) {
          const newHashes = room.blobHashes.slice(blobHashesRef.current.length);
          blobHashesRef.current = room.blobHashes;

          if (userId && newHashes.length > 0) {
            console.log("[History] New drawing detected for user:", userId, newHashes);
          }
        }
      } finally {
        isQuerying = false;
        if (pending) {
          pending = false;
          runQuery();
        }
      }
    };

    const handleNotification = (_notification: any) => {
      runQuery();
    };

    const maybeUnsubscribe = (client as any).onNotification?.(handleNotification);

    runQuery();

    return () => {
      if (typeof maybeUnsubscribe === 'function') {
        try { maybeUnsubscribe(); } catch { }
      } else {
        try { (client as any).offNotification?.(handleNotification); } catch { }
      }
    };
  }, [client, application, ready]);

  // Compute timeLeft from backend timestamps
  // Removed redundant recomputation tied to players/showWordSelector to prevent jitter; rely on smooth interval below.

  // Auto choose a word for drawer after 15s
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const amIDrawer = players[(room.currentDrawerIndex ?? -1)]?.id === chainId;
    const awaitingWord = (room.gameState === 'WaitingForWord' || room.gameState === 'WAITING_FOR_WORD') && room.drawerChosenAt && !room.wordChosenAt;
    if (!amIDrawer || !awaitingWord) return;

    const nowSec = Date.now() / 1000;
    const drawerChosenSec = parseInt(room.drawerChosenAt) / 1000000;
    const elapsed = Math.max(0, nowSec - drawerChosenSec);
    const remainingMs = Math.max(0, (15 - elapsed) * 1000);

    if (autoWordTimeoutRef.current) {
      clearTimeout(autoWordTimeoutRef.current);
      autoWordTimeoutRef.current = null;
    }
    autoWordTimeoutRef.current = window.setTimeout(() => {
      if (!roomRef.current?.wordChosenAt) {
        const choice = (wordOptions.length ? wordOptions : FIXED_WORD_OPTIONS)[0];
        handleChooseWord(choice);
      }
    }, remainingMs);

    return () => {
      if (autoWordTimeoutRef.current) {
        clearTimeout(autoWordTimeoutRef.current);
        autoWordTimeoutRef.current = null;
      }
    };
  }, [players, showWordSelector, wordOptions]);

  // Auto advance to next drawer when drawing ends (host only)
  useEffect(() => {
    const room = roomRef.current;
    if (!room || !isHost) return;
    if ((room.gameState === 'Drawing' || room.gameState === 'DRAWING') && room.wordChosenAt) {
      const nowSec = Date.now() / 1000;
      const wordChosenSec = parseInt(room.wordChosenAt) / 1000000;
      const elapsed = Math.max(0, nowSec - wordChosenSec);
      const remainingMs = Math.max(0, ((room.secondsPerRound ?? settings.roundTime) - elapsed) * 1000);
      const scheduledDrawerIndex = room.currentDrawerIndex ?? 0;
      const scheduledWordChosenAt = room.wordChosenAt;
      const scheduleKey = `${scheduledDrawerIndex}|${scheduledWordChosenAt ?? 'none'}`;
      if (autoDrawerScheduleKeyRef.current !== scheduleKey) {
        autoDrawerScheduleKeyRef.current = scheduleKey;
        if (autoDrawerTimeoutRef.current) {
          clearTimeout(autoDrawerTimeoutRef.current);
          autoDrawerTimeoutRef.current = null;
        }
        autoDrawerTimeoutRef.current = window.setTimeout(() => {
          const latest = roomRef.current;
          const stillDrawing = latest && (latest.gameState === 'Drawing' || latest.gameState === 'DRAWING');
          const sameDrawer = latest && (latest.currentDrawerIndex ?? 0) === scheduledDrawerIndex;
          const sameWordTiming = latest && latest.wordChosenAt === scheduledWordChosenAt;
          if (!stillDrawing || !sameDrawer || !sameWordTiming) return;
          handleChooseDrawer('auto_drawing_timer');
        }, remainingMs);
      }
    } else {
      // clear when not drawing
      if (autoDrawerTimeoutRef.current) {
        clearTimeout(autoDrawerTimeoutRef.current);
        autoDrawerTimeoutRef.current = null;
      }
      autoDrawerScheduleKeyRef.current = null;
      autoDrawerFireKeyRef.current = null;
    }
  }, [players, timeLeft]);

  // Reset chooseDrawer in-flight when state transitions
  useEffect(() => {
    const room = roomRef.current;
    const awaitingWord = room && (room.gameState === 'WaitingForWord' || room.gameState === 'WAITING_FOR_WORD');
    if (awaitingWord || room?.wordChosenAt) {
      chooseDrawerInFlightRef.current = false;
    }
  }, [players]);

  const handleChooseWord = async (word: string) => {
    if (!application || !ready) return;
    try {
      await application.query('{ "query": "mutation { chooseWord(word: \\\"' + word + '\\\") }" }');
      setShowWordSelector(false);
      setCurrentWord(word);
    } catch { }
  };

  const handleSendMessage = async (message: string) => {
    if (!application || !ready) return;
    const room = roomRef.current;
    const amIDrawer = players[(room?.currentDrawerIndex ?? -1)]?.id === chainId;
    if (amIDrawer) return;
    try {
      await application.query('{ "query": "mutation { guessWord(guess: \\\"' + message + '\\\") }" }');
    } catch { }
  };

  const handleChooseDrawer = async (source?: string) => {
    if (!application || !ready || !isHost) return;
    const state = roomRef.current;
    if (state && (state.gameState === 'WaitingForWord' || state.gameState === 'WAITING_FOR_WORD') && state.drawerChosenAt && !state.wordChosenAt) {
      return;
    }
    if (chooseDrawerInFlightRef.current) return;
    chooseDrawerInFlightRef.current = true;

    // Screenshot and Publish Blob (Async)
    if (canvasCompRef.current) {
      // Collect Metadata - grab chat from room state directly to avoid timing issues
      const room = roomRef.current;
      const chatData = (room?.chatMessages ?? [])
        .filter((m: any) => m && m.playerName && m.message)
        .map((m: any) => ({
          sender: m.playerName,
          text: m.message
        }));

      const metadata = {
        players: players.map(p => ({
          id: p.id,
          name: p.name,
          score: p.score
        })),
        chat: chatData,
        round: round,
        word: currentWord // Might be empty if not drawer, but useful context
      };

      console.log("Publishing blob with metadata:", metadata);

      // Fire and forget - don't block the game flow
      canvasCompRef.current.publishBlob(metadata).then(hash => {
        console.log("Async blob published:", hash);
        if (hash) {
          blobHashesRef.current.push(hash);
          // Server auto-saves history for all room members, no need to call saveHistoryToServer here
        }
      }).catch(err => {
        console.error("Async blob publish failed:", err);
      });
    }

    try {
      // Call mutation immediately without waiting for blob
      // No arguments needed for chooseDrawer now
      await application.query(`{ "query": "mutation { chooseDrawer }" }`);
    } catch { }
  };

  // End game if backend says so
  useEffect(() => {
    const room = roomRef.current;
    if (room && (room.gameState === 'GameEnded' || room.gameState === 'GAME_ENDED')) {
      onGameEnd(players);
    }
  }, [players]);

  // Smooth timer tick every second, recomputes from backend timestamps
  useEffect(() => {
    const tick = () => {
      const room = roomRef.current;
      if (!room) return;
      const nowSec = Date.now() / 1000;
      if ((room.gameState === 'WaitingForWord' || room.gameState === 'WAITING_FOR_WORD') && room.drawerChosenAt && !room.wordChosenAt) {
        const drawerChosenSec = parseInt(room.drawerChosenAt) / 1000000;
        const elapsed = Math.max(0, nowSec - drawerChosenSec);
        setTimeLeft(Math.max(0, Math.ceil(15 - elapsed)));
      } else if ((room.gameState === 'Drawing' || room.gameState === 'DRAWING') && room.wordChosenAt) {
        const wordChosenSec = parseInt(room.wordChosenAt) / 1000000;
        const elapsed = Math.max(0, nowSec - wordChosenSec);
        setTimeLeft(Math.max(0, Math.ceil((room.secondsPerRound ?? settings.roundTime) - elapsed)));
      } else {
        setTimeLeft(settings.roundTime);
      }
    };
    const id = window.setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [settings.roundTime]);

  const currentPlayer = players.find((p) => p.id === chainId);
  const isDrawing = currentPlayer?.isDrawing || false;

  // Clear canvas on drawer change while still in drawing state
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const currentDrawerIndex = room.currentDrawerIndex ?? null;
    const gameState = room.gameState;
    const prevIndex = prevDrawerIndexRef.current;
    if (
      prevIndex !== null &&
      currentDrawerIndex !== null &&
      prevIndex !== currentDrawerIndex &&
      (gameState === 'Drawing' || gameState === 'DRAWING')
    ) {
      try {
        // Clear locally via ref
        canvasCompRef.current?.clearCanvas();
      } catch { }
      // Also reset canvasData so Canvas re-renders clean
      setCanvasData("");
    }
    prevDrawerIndexRef.current = currentDrawerIndex;
  }, [players]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <GameHeader
        round={roomRef.current?.currentRound ?? round}
        totalRounds={roomRef.current?.totalRounds ?? settings.totalRounds}
        timeLeft={timeLeft}
        hostChainId={hostChainId}
        onLeave={async () => {
          if (!application || !ready) return;

          if (isHost) {
            // HOST: Send accumulated hashes and sync history
            try {
              const capturedHashes = blobHashesRef.current || [];
              console.log("Host leaving with hashes:", capturedHashes);

              const mutation = capturedHashes.length > 0
                ? `mutation { leaveRoom(blobHashes: ${JSON.stringify(capturedHashes)}) }`
                : `mutation { leaveRoom }`;

              await application.query(JSON.stringify({ query: mutation }));

              // Server auto-saves history for all room members, no manual save needed
            } catch (e) {
              console.error("Host leave error:", e);
              // Fallback: simple leave
              try { await application.query('{ "query": "mutation { leaveRoom }" }'); } catch { }
            }
          } else {
            // PLAYER: Just leave
            try {
              await application.query('{ "query": "mutation { leaveRoom }" }');
            } catch { }
          }
        }}
      />

      <div className="flex-1 flex gap-4 p-4 max-w-[1600px] mx-auto w-full">
        <PlayersList players={players} />

        <div className="flex-1 flex flex-col gap-4">
          {showWordSelector && isDrawing && (
            <WordSelector
              words={wordOptions}
              onSelect={handleChooseWord}
            />
          )}
          <div style={{ display: (showWordSelector && isDrawing) ? 'none' : 'block' }} className="flex-1">
            <Canvas
              ref={canvasCompRef as any}
              isDrawing={isDrawing}
              onCanvasChange={setCanvasData}
              canvasData={canvasData}
              roomId={hostChainId}
              clientId={chainId || 'local'}
              userId={userId}
            />
          </div>
        </div>

        <ChatPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          isDrawing={isDrawing}
          hasGuessed={currentPlayer?.hasGuessed || false}
        />
      </div>
    </div>
  );
}
