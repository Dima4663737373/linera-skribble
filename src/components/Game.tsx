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

interface GameProps {
  playerName: string;
  hostChainId: string;
  settings: GameSettings;
  onGameEnd: (players: Player[]) => void;
  onBackToLobby: () => void;
}

export function Game({ playerName, hostChainId, settings, onGameEnd, onBackToLobby }: GameProps) {
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
  const chooseDrawerInFlightRef = useRef<boolean>(false);
  const lastChooseDrawerCallRef = useRef<number>(0);
  const lastQueryAtRef = useRef<number>(0);

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

  const queryGameState = async () => {
    if (!application || !ready) return;
    try {
      const roomResponse = await application.query(
        '{ "query": "query { room { hostChainId players { chainId name score hasGuessed } gameState currentRound totalRounds secondsPerRound currentDrawerIndex wordChosenAt drawerChosenAt chatMessages { playerName message isCorrectGuess pointsAwarded } } }" }'
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
          // Generate 3 unique words
          const set = new Set<string>();
          while (set.size < 3) {
            set.add(WORDS[Math.floor(Math.random() * WORDS.length)]);
          }
          setWordOptions(Array.from(set));
        }
        // Messages mapping (last 20)
      const msgs = (room.chatMessages ?? [])
        .filter((m: any) => m && m.playerName && m.message)
        .slice(-20)
        .map((m: any, idx: number) => ({
        id: `${Date.now()}-${idx}`,
        playerId: m.playerName ?? `p-${idx}`,
        playerName: m.playerName ?? 'Player',
        message: m.message ?? '',
        isCorrect: !!m.isCorrectGuess,
        timestamp: Date.now(),
      }));
      setMessages(msgs);
      // Track last query time (TTL for debounced notifications)
      lastQueryAtRef.current = Date.now();
    }
  } catch {}
  };

  // Subscribe to notifications with debounce and TTL; remove polling
  useEffect(() => {
    if (!client || !application || !ready) return;

    let queryTimeout: number | null = null;
    let isQuerying = false;

    const debouncedQuery = () => {
      if (queryTimeout) {
        window.clearTimeout(queryTimeout);
      }
      queryTimeout = window.setTimeout(() => {
        const now = Date.now();
        const elapsed = now - lastQueryAtRef.current;
        if (elapsed < 400) {
          // Skip if we queried very recently
          return;
        }
        if (!isQuerying) {
          isQuerying = true;
          queryGameState().finally(() => {
            isQuerying = false;
          });
        }
      }, 500);
    };

    const handleNotification = (_notification: any) => {
      debouncedQuery();
    };

    const maybeUnsubscribe = (client as any).onNotification?.(handleNotification);

    // No initial query; rely solely on subscription-triggered queries

    return () => {
      if (queryTimeout) {
        window.clearTimeout(queryTimeout);
      }
      if (typeof maybeUnsubscribe === 'function') {
        try { maybeUnsubscribe(); } catch {}
      } else {
        try { (client as any).offNotification?.(handleNotification); } catch {}
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
        const choice = (wordOptions.length ? wordOptions : [
          WORDS[Math.floor(Math.random() * WORDS.length)],
          WORDS[Math.floor(Math.random() * WORDS.length)],
          WORDS[Math.floor(Math.random() * WORDS.length)],
        ])[0];
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
    } catch {}
  };

  const handleSendMessage = async (message: string) => {
    if (!application || !ready) return;
    const room = roomRef.current;
    const amIDrawer = players[(room?.currentDrawerIndex ?? -1)]?.id === chainId;
    if (amIDrawer) return;
    try {
      await application.query('{ "query": "mutation { guessWord(guess: \\\"' + message + '\\\") }" }');
    } catch {}
  };

  const handleChooseDrawer = async (source?: string) => {
    if (!application || !ready || !isHost) return;
    const state = roomRef.current;
    if (state && (state.gameState === 'WaitingForWord' || state.gameState === 'WAITING_FOR_WORD') && state.drawerChosenAt && !state.wordChosenAt) {
      return;
    }
    if (chooseDrawerInFlightRef.current) return;
    const now = Date.now();
    if (now - lastChooseDrawerCallRef.current < 2000) return;
    lastChooseDrawerCallRef.current = now;
    chooseDrawerInFlightRef.current = true;
    try {
      await application.query('{ "query": "mutation { chooseDrawer }" }');
    } catch {}
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
      } catch {}
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
          try {
            await application.query('{ "query": "mutation { leaveRoom }" }');
          } catch {}
        }}
      />

      <div className="flex-1 flex gap-4 p-4 max-w-[1600px] mx-auto w-full">
        <PlayersList players={players} />

        <div className="flex-1 flex flex-col gap-4">
          {showWordSelector && isDrawing ? (
            <WordSelector
              words={wordOptions.length ? wordOptions : [
                WORDS[Math.floor(Math.random() * WORDS.length)],
                WORDS[Math.floor(Math.random() * WORDS.length)],
                WORDS[Math.floor(Math.random() * WORDS.length)],
              ]}
              onSelect={handleChooseWord}
            />
          ) : (
            <Canvas
              ref={canvasCompRef as any}
              isDrawing={isDrawing}
              onCanvasChange={setCanvasData}
              canvasData={canvasData}
              roomId={hostChainId}
              clientId={chainId || 'local'}
            />
          )}
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
