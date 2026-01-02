import { useState, useRef, useEffect, useMemo } from "react";
import { Canvas, CanvasHandle } from "./Canvas";
import { ChatPanel } from "./ChatPanel";
import { PlayersList } from "./PlayersList";
import { GameHeader } from "./GameHeader";
import { WordSelector } from "./WordSelector";
import { GameSettings } from "./WaitingRoom";
import { useLinera } from "./LineraProvider";
import { cn } from "./ui/utils";

export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawing: boolean;
  hasGuessed: boolean;
  status?: string;
  avatarJson?: string;
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
  settings: GameSettings;
  onGameEnd: (players: Player[], blobHashes: string[]) => void;
  onBackToLobby: () => void;
}

export function Game({ playerName, hostChainId, settings, onGameEnd, onBackToLobby }: GameProps) {
  const { client, application, chainId, ready } = useLinera();

  const [players, setPlayers] = useState<Player[]>([]);
  const [roomMessages, setRoomMessages] = useState<ChatMessage[]>([]);
  const [systemMessages, setSystemMessages] = useState<ChatMessage[]>([]);
  const [currentWord, setCurrentWord] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(settings.roundTime);
  const [round, setRound] = useState<number>(1);
  const [showWordSelector, setShowWordSelector] = useState<boolean>(false);
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [canvasData, setCanvasData] = useState<string>("");
  const canvasCompRef = useRef<CanvasHandle | null>(null);
  const wordOptionsRef = useRef<string[]>([]);
  const pendingBackToLobbyTimeoutRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [wideLayout, setWideLayout] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1150;
  });

  // Backend room tracking
  const roomRef = useRef<any>(null);
  const autoWordTimeoutRef = useRef<number | null>(null);
  const autoDrawerTimeoutRef = useRef<number | null>(null);
  const autoDrawerScheduleKeyRef = useRef<string | null>(null);
  const autoDrawerFireKeyRef = useRef<string | null>(null);
  const chooseDrawerInFlightRef = useRef(false);
  const blobHashesRef = useRef<string[]>([]); // Store accumulated blob hashes locally
  const lastBlobPublishRef = useRef<Promise<string> | null>(null);
  const sentGameEndRef = useRef(false);
  const sentWordForTurnRef = useRef<string | null>(null);
  const systemNoticeRef = useRef<{ turnKey: string | null; fired: Record<string, boolean> }>({ turnKey: null, fired: {} });

  const isHost = roomRef.current?.hostChainId === chainId;

  // Track previous drawer index to detect changes
  const prevDrawerIndexRef = useRef<number | null>(null);
  const prevTurnKeyRef = useRef<string | null>(null);

  useEffect(() => {
    wordOptionsRef.current = wordOptions;
  }, [wordOptions]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pendingBackToLobbyTimeoutRef.current) {
        clearTimeout(pendingBackToLobbyTimeoutRef.current);
        pendingBackToLobbyTimeoutRef.current = null;
      }
      if (autoWordTimeoutRef.current) {
        clearTimeout(autoWordTimeoutRef.current);
        autoWordTimeoutRef.current = null;
      }
      if (autoDrawerTimeoutRef.current) {
        clearTimeout(autoDrawerTimeoutRef.current);
        autoDrawerTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return;

    const compute = () => {
      const w = el.getBoundingClientRect().width;
      const next = w >= 1150;
      setWideLayout((prev) => (prev === next ? prev : next));
    };

    compute();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => compute()) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", compute);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, []);

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
    prevTurnKeyRef.current = null;
    setShowWordSelector(false);
    setWordOptions([]);
    setCanvasData("");
    setCurrentWord("");
    setRoomMessages([]);
    setSystemMessages([]);
  };

  const applyRoomState = (room: any, currentWordFromQuery?: any) => {
    roomRef.current = room;

    const mappedPlayers: Player[] = (room.players ?? []).map((p: any, idx: number) => ({
      id: p.chainId,
      name: p.name,
      avatarJson: p.avatarJson,
      score: p.score ?? 0,
      isDrawing: (room.currentDrawerIndex ?? -1) === idx,
      hasGuessed: !!p.hasGuessed,
      status: typeof p.status === "string" ? p.status : undefined,
    }));
    setPlayers(mappedPlayers);

    setRound(room.currentRound ?? 1);

    const amIDrawer = mappedPlayers[(room.currentDrawerIndex ?? -1)]?.id === chainId;
    const isDrawingPhase = room.gameState === "Drawing" || room.gameState === "DRAWING";
    const awaitingWord =
      (room.gameState === "WaitingForWord" || room.gameState === "WAITING_FOR_WORD") &&
      room.drawerChosenAt &&
      !room.wordChosenAt;
    setShowWordSelector(Boolean(awaitingWord && amIDrawer));
    if (awaitingWord && amIDrawer && wordOptionsRef.current.length === 0) {
      setWordOptions(FIXED_WORD_OPTIONS);
    }
    if (!amIDrawer || awaitingWord || !isDrawingPhase) {
      setCurrentWord("");
    } else {
      const next = typeof currentWordFromQuery === "string" ? currentWordFromQuery.trim() : "";
      if (next) {
        setCurrentWord((prev) => (prev === next ? prev : next));
      }
    }

    const msgs: ChatMessage[] = (room.chatMessages ?? [])
      .filter((m: any) => m && m.playerName && m.message)
      .map((m: any, idx: number) => ({
        id: `${idx}-${String(m.playerName ?? "")}-${String(m.message ?? "")}-${m.isCorrectGuess ? 1 : 0}-${String(m.pointsAwarded ?? "")}`,
        playerId: String(m.playerName ?? `p-${idx}`),
        playerName: String(m.playerName ?? "Player"),
        message: String(m.message ?? ""),
        isCorrect: !!m.isCorrectGuess,
        timestamp: idx,
      }));
    setRoomMessages((prev) => {
      if (prev.length !== msgs.length) return msgs;
      for (let i = 0; i < prev.length; i++) {
        const a = prev[i];
        const b = msgs[i];
        if (
          a.id !== b.id ||
          a.playerId !== b.playerId ||
          a.playerName !== b.playerName ||
          a.message !== b.message ||
          Boolean(a.isCorrect) !== Boolean(b.isCorrect)
        ) {
          return msgs;
        }
      }
      return prev;
    });
  };

  const queryGameState = async () => {
    if (!application || !ready) return;
    try {
      const roomResponse = await application.query(
        '{ "query": "query { currentWord room { hostChainId players { chainId name avatarJson score hasGuessed status } gameState currentRound totalRounds secondsPerRound currentDrawerIndex wordChosenAt drawerChosenAt blobHashes chatMessages { playerName message isCorrectGuess pointsAwarded } } }" }'
      );
      if (!aliveRef.current) return;
      const roomData = JSON.parse(roomResponse);
      const room = roomData.data?.room;
      const currentWordFromQuery = roomData.data?.currentWord;
      const matchesHost = room?.hostChainId && String(room.hostChainId).trim() === String(hostChainId).trim();
      if (!room || !matchesHost) {
        if (roomRef.current) {
          if (!pendingBackToLobbyTimeoutRef.current) {
            pendingBackToLobbyTimeoutRef.current = window.setTimeout(async () => {
              pendingBackToLobbyTimeoutRef.current = null;
              if (!aliveRef.current) return;
              if (!application || !ready) return;
              try {
                const retry = await application.query(
                  '{ "query": "query { currentWord room { hostChainId players { chainId name avatarJson score hasGuessed status } gameState currentRound totalRounds secondsPerRound currentDrawerIndex wordChosenAt drawerChosenAt blobHashes chatMessages { playerName message isCorrectGuess pointsAwarded } } }" }'
                );
                if (!aliveRef.current) return;
                const parsed = JSON.parse(retry);
                const roomAfter = parsed?.data?.room;
                const currentWordAfter = parsed?.data?.currentWord;
                const matchesAfter = roomAfter?.hostChainId && String(roomAfter.hostChainId).trim() === String(hostChainId).trim();
                if (!roomAfter || !matchesAfter) {
                  cleanupRoomSession();
                  if (aliveRef.current) onBackToLobby();
                  return;
                }
                applyRoomState(roomAfter, currentWordAfter);
              } catch {}
            }, 2000);
          }
        }
        return;
      }
      if (pendingBackToLobbyTimeoutRef.current) {
        clearTimeout(pendingBackToLobbyTimeoutRef.current);
        pendingBackToLobbyTimeoutRef.current = null;
      }
      applyRoomState(room, currentWordFromQuery);
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
          blobHashesRef.current = room.blobHashes;
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
    const intervalId = window.setInterval(() => {
      runQuery();
    }, 1000);

    return () => {
      clearInterval(intervalId);
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

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const currentDrawerIndex = room.currentDrawerIndex ?? -1;
    const drawerId = players[currentDrawerIndex]?.id;
    const amIDrawer = drawerId && drawerId === chainId;
    const turnId = room.wordChosenAt ? String(room.wordChosenAt) : "";
    if (!amIDrawer) return;
    const w = String(currentWord || "").trim();
    if (!w) return;
    if (!turnId) return;
    if (sentWordForTurnRef.current === turnId) return;
    sentWordForTurnRef.current = turnId;
    try {
      canvasCompRef.current?.sendChosenWord(w, round, turnId);
    } catch { }
  }, [players, currentWord]);

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
          score: p.score,
          avatarJson: p.avatarJson || "",
        })),
        chat: chatData,
        round: round,
        word: "",
        drawerId: players[(room?.currentDrawerIndex ?? -1)]?.id ?? "",
        turnId: room?.wordChosenAt ? String(room.wordChosenAt) : "",
      };

      console.log("Publishing blob with metadata:", metadata);

      // Fire and forget - don't block the game flow
      const p = canvasCompRef.current.publishBlob(metadata);
      lastBlobPublishRef.current = p;
      p.then(hash => {
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
    if (!room || sentGameEndRef.current) return;
    if (room.gameState === 'GameEnded' || room.gameState === 'GAME_ENDED') {
      sentGameEndRef.current = true;
      const waitForLast = lastBlobPublishRef.current
        ? Promise.race([lastBlobPublishRef.current, new Promise<string>((resolve) => setTimeout(() => resolve(""), 1500))])
        : Promise.resolve("");
      waitForLast.finally(() => {
        const unique = Array.from(new Set(blobHashesRef.current.filter(Boolean)));
        onGameEnd(players, unique);
      });
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
  const mergedMessages = useMemo(() => {
    if (!systemMessages.length) return roomMessages;
    if (!roomMessages.length) return systemMessages;
    return [...roomMessages, ...systemMessages];
  }, [roomMessages, systemMessages]);

  // Clear canvas when a new turn starts (round or drawer change)
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const currentDrawerIndexRaw = room.currentDrawerIndex;
    const currentRoundRaw = room.currentRound;
    const currentDrawerIndex = Number(currentDrawerIndexRaw);
    const currentRound = Number(currentRoundRaw);
    if (!Number.isFinite(currentDrawerIndex) || currentDrawerIndex < 0) return;
    if (!Number.isFinite(currentRound) || currentRound < 1) return;

    const turnKey = `${currentRound}-${currentDrawerIndex}`;
    const prevKey = prevTurnKeyRef.current;

    const isFirstObservedTurn = !prevKey;
    const isNewTurn = prevKey && prevKey !== turnKey;
    const isNewGameFirstTurn = isFirstObservedTurn && currentRound === 1;

    if (isNewTurn || isNewGameFirstTurn) {
      setCanvasData("");
      setSystemMessages([]);
      systemNoticeRef.current = { turnKey, fired: {} };
      const drawerId = players[currentDrawerIndex]?.id;
      const amIDrawer = drawerId && drawerId === chainId;
      if (amIDrawer) {
        try { canvasCompRef.current?.clearCanvas(); } catch { }
      } else if (isNewGameFirstTurn) {
        const amIHost = String(room.hostChainId ?? "") === String(chainId ?? "");
        if (amIHost) {
          try { canvasCompRef.current?.clearCanvas(); } catch { }
        }
      }
    }

    prevTurnKeyRef.current = turnKey;
    prevDrawerIndexRef.current = currentDrawerIndex;
  }, [players, chainId]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const isDrawingPhase = room.gameState === "Drawing" || room.gameState === "DRAWING";
    if (!isDrawingPhase || !room.wordChosenAt) return;

    const currentDrawerIndex = Number(room.currentDrawerIndex);
    const currentRound = Number(room.currentRound);
    if (!Number.isFinite(currentDrawerIndex) || currentDrawerIndex < 0) return;
    if (!Number.isFinite(currentRound) || currentRound < 1) return;
    const turnKey = `${currentRound}-${currentDrawerIndex}`;
    if (systemNoticeRef.current.turnKey !== turnKey) {
      systemNoticeRef.current = { turnKey, fired: {} };
      setSystemMessages([]);
    }

    const thresholds: Record<number, string> = {
      30: "30 seconds left in the round.",
      20: "20 seconds left in the round.",
      10: "10 seconds left in the round.",
      5: "5 seconds left in the round.",
      0: "Time's up!",
    };
    const text = thresholds[timeLeft];
    if (!text) return;
    const key = String(timeLeft);
    if (systemNoticeRef.current.fired[key]) return;
    systemNoticeRef.current.fired[key] = true;
    setSystemMessages((prev) => {
      const id = `system-${turnKey}-${timeLeft}`;
      if (prev.some((m) => m.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          playerId: "system",
          playerName: "System",
          message: text,
          isCorrect: false,
          timestamp: Date.now(),
        },
      ];
    });
  }, [timeLeft]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <GameHeader
        round={roomRef.current?.currentRound ?? round}
        totalRounds={roomRef.current?.totalRounds ?? settings.totalRounds}
        timeLeft={timeLeft}
        currentWord={isDrawing ? currentWord : ""}
        isDrawing={isDrawing}
        hostChainId={hostChainId}
        onLeave={async () => {
          if (!application || !ready) return;

          if (isHost) {
            // HOST: Send accumulated hashes and sync history
            try {
              if (lastBlobPublishRef.current) {
                try {
                  await Promise.race([
                    lastBlobPublishRef.current,
                    new Promise<string>((resolve) => setTimeout(() => resolve(""), 1500)),
                  ]);
                } catch {}
              }
              const capturedHashes = Array.from(new Set((blobHashesRef.current || []).filter(Boolean)));
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

      <div className="flex-1 w-full">
        <div ref={layoutRef} className="mx-auto w-full max-w-[1400px] px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div
            className={cn(
              "flex",
              wideLayout ? "flex-row items-start gap-4" : "flex-col gap-3 sm:gap-4 max-w-[560px] mx-auto"
            )}
          >
            <PlayersList
              players={players}
              localPlayerId={chainId || ""}
              className={wideLayout ? "w-64 shrink-0" : "w-full"}
            />

            <div
              className={cn(
                "flex-1 min-w-0 flex flex-col",
                wideLayout ? "gap-4" : "gap-3 sm:gap-4 w-full"
              )}
            >
              {showWordSelector && isDrawing && (
                <WordSelector
                  words={wordOptions}
                  onSelect={handleChooseWord}
                />
              )}
              <div
                style={{ display: (showWordSelector && isDrawing) ? 'none' : 'block' }}
                className={cn("flex-1", wideLayout ? "min-h-[360px]" : "min-h-[280px]")}
              >
                <Canvas
                  ref={canvasCompRef as any}
                  isDrawing={isDrawing}
                  onCanvasChange={setCanvasData}
                  canvasData={canvasData}
                  roomId={hostChainId}
                  clientId={chainId || 'local'}
                />
              </div>
            </div>

            <ChatPanel
              messages={mergedMessages}
              onSendMessage={handleSendMessage}
              isDrawing={isDrawing}
              hasGuessed={currentPlayer?.hasGuessed || false}
              className={
                wideLayout
                  ? "w-80 shrink-0 h-[calc(100vh-180px)]"
                  : "w-full h-[280px] sm:h-[320px]"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
