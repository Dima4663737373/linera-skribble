import { useEffect, useRef } from "react";

type RoomData = {
  hostChainId?: string;
  gameState?: string;
  totalRounds?: number;
  secondsPerRound?: number;
  players?: Array<{ chainId: string; name: string; avatarJson?: string; status?: string }>;
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
  const hasSeenRoomRef = useRef<boolean>(false);
  const seenHostRef = useRef<boolean>(false);

  useEffect(() => {
    if (!client || !application || !ready) return;

    const poll = async () => {
      try {
        const res = await application.query(
          '{ "query": "query { room { hostChainId gameState totalRounds secondsPerRound players { chainId name avatarJson status } } }" }'
        );
        const json = typeof res === "string" ? JSON.parse(res) : res;
        const data: RoomData | undefined = json?.data?.room;
        const matchesHost = data?.hostChainId && String(data.hostChainId).trim() === String(hostChainId).trim();
        let hostPresent = false;
        if (data?.players && Array.isArray(data.players)) {
          hostPresent = data.players.some((p) => String(p.chainId).trim() === String(hostChainId).trim());
        }

        const isInvalid = !data || !matchesHost || (!isHost && hasSeenRoomRef.current && seenHostRef.current && !hostPresent);

        if (isInvalid) {
          if (isHost) return;
          if (!hasSeenRoomRef.current) return;
          onRoomNullOrMismatch();
          return;
        }

        hasSeenRoomRef.current = true;
        seenHostRef.current = hostPresent;
        onRoomData(data);
      } catch {}
    };

    const unsubscribe = client?.onNotification?.(() => {
      poll();
    });

    poll();

    return () => {
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch {}
      } else {
        try {
          client?.offNotification?.(poll);
        } catch {}
      }
    };
  }, [client, application, ready, hostChainId, isHost]);
}
