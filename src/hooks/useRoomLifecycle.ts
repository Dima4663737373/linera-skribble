import { useEffect, useRef } from "react";

type RoomData = {
  hostChainId?: string;
  gameState?: string;
  totalRounds?: number;
  secondsPerRound?: number;
  players?: Array<{ chainId: string; name: string }>;
};

export function useRoomLifecycle(opts: {
  client: any;
  application: any;
  ready: boolean;
  hostChainId: string;
  isHost: boolean;
  onRoomData: (data: RoomData) => void;
  onRoomNullOrMismatch: () => void;
}) {
  const { client, application, ready, hostChainId, isHost, onRoomData, onRoomNullOrMismatch } = opts;
  const debounceRef = useRef<number | null>(null);
  const hasSeenRoomRef = useRef<boolean>(false);
  const firstValidAtRef = useRef<number | null>(null);
  const lastInvalidAtRef = useRef<number>(0);
  const invalidCountRef = useRef<number>(0);
  const GRACE_MS = 2000;
  const BURST_TTL_MS = 800;
  const seenHostRef = useRef<boolean>(false);

  useEffect(() => {
    if (!client || !application || !ready) return;

    const debouncedPoll = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      debounceRef.current = window.setTimeout(async () => {
        try {
          const res = await application.query(
            '{ "query": "query { room { hostChainId gameState totalRounds secondsPerRound players { chainId name } } }" }'
          );
          const json = typeof res === "string" ? JSON.parse(res) : res;
          const data: RoomData | undefined = json?.data?.room;
          const matchesHost = data?.hostChainId && String(data.hostChainId).trim() === String(hostChainId).trim();
          let hostPresent = false;
          if (data?.players && Array.isArray(data.players)) {
            hostPresent = data.players.some((p) => String(p.chainId).trim() === String(hostChainId).trim());
          }

          const now = Date.now();
          const withinGrace = firstValidAtRef.current !== null && (now - (firstValidAtRef.current || 0)) < GRACE_MS;

          const isInvalid = !data || !matchesHost || (!isHost && hasSeenRoomRef.current && seenHostRef.current && !hostPresent);

          if (isInvalid) {
            if (isHost) {
              return;
            }
            if (!hasSeenRoomRef.current) {
              return;
            }
            const elapsed = now - lastInvalidAtRef.current;
            if (elapsed < BURST_TTL_MS) {
              invalidCountRef.current += 1;
            } else {
              invalidCountRef.current = 1;
            }
            lastInvalidAtRef.current = now;
            if ((withinGrace && invalidCountRef.current >= 2) || (!withinGrace && invalidCountRef.current >= 1)) {
              invalidCountRef.current = 0;
              onRoomNullOrMismatch();
            }
            return;
          }

          hasSeenRoomRef.current = true;
          if (firstValidAtRef.current === null) {
            firstValidAtRef.current = now;
          }
          seenHostRef.current = hostPresent;
          invalidCountRef.current = 0;
          onRoomData(data);
        } catch {}
      }, 400);
    };

    const unsubscribe = client?.onNotification?.(() => {
      debouncedPoll();
    });

    debouncedPoll();

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch {}
      } else {
        try {
          client?.offNotification?.(debouncedPoll);
        } catch {}
      }
    };
  }, [client, application, ready, hostChainId, isHost]);
}
