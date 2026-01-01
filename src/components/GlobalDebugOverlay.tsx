import { useEffect, useState } from "react";
import { Button } from "./ui/button";

interface GlobalDebugOverlayProps {
  application?: any;
  client?: any;
  ready: boolean;
}

const ROOM_QUERY = 'query { room { hostChainId gameState totalRounds secondsPerRound players { chainId name avatarJson } } }';
const GAME_QUERY = 'query { room { hostChainId players { chainId name avatarJson score hasGuessed } gameState currentRound totalRounds secondsPerRound currentDrawerIndex wordChosenAt drawerChosenAt chatMessages { playerName message isCorrectGuess pointsAwarded } } }';

export function GlobalDebugOverlay({ application, client, ready }: GlobalDebugOverlayProps) {
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(true);
  const [tab, setTab] = useState<'room' | 'game' | 'custom'>('room');
  const [rawGraphql, setRawGraphql] = useState(true);
  const [queryText, setQueryText] = useState(ROOM_QUERY);
  const [resp, setResp] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab === 'room') setQueryText(ROOM_QUERY);
    else if (tab === 'game') setQueryText(GAME_QUERY);
  }, [tab]);

  const buildPayload = () => {
    if (rawGraphql) return '{ "query": "' + queryText.replace(/"/g, '\\"') + '" }';
    return queryText;
  };

  const runQuery = async () => {
    if (!application || !ready) return;
    setLoading(true);
    try {
      const res = await application.query(buildPayload());
      const data = typeof res === "string" ? (() => { try { return JSON.parse(res); } catch { return res; } })() : res;
      const txt = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      setResp(txt);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!client || !application || !ready || !auto) return;
    let inFlight = false;
    let pending = false;

    const requestQuery = () => {
      if (inFlight) {
        pending = true;
        return;
      }

      inFlight = true;
      runQuery()
        .catch(() => {})
        .finally(() => {
          inFlight = false;
          if (pending) {
            pending = false;
            requestQuery();
          }
        });
    };

    const handleNotification = () => {
      requestQuery();
    };

    const unsub = client?.onNotification?.(handleNotification);
    requestQuery();
    return () => {
      if (typeof unsub === "function") {
        try { unsub(); } catch {}
      } else {
        try { client?.offNotification?.(handleNotification); } catch {}
      }
    };
  }, [client, application, ready, auto, queryText, rawGraphql]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'd') setOpen((v) => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!open ? (
        <Button onClick={() => setOpen(true)} className="border-2 border-black bg-black text-white">Debug</Button>
      ) : (
        <div className="w-[420px] bg-white border-2 border-black rounded-lg shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 bg-black text-white rounded-t-lg">
            <div className="flex items-center gap-2">
              <Button onClick={() => setTab('room')} variant={tab==='room'?'default':'outline'} className="border-2 border-white text-white">Room</Button>
              <Button onClick={() => setTab('game')} variant={tab==='game'?'default':'outline'} className="border-2 border-white text-white">Game</Button>
              <Button onClick={() => setTab('custom')} variant={tab==='custom'?'default':'outline'} className="border-2 border-white text-white">Custom</Button>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
              </label>
              <Button onClick={() => setOpen(false)} variant="outline" className="border-2 border-white text-white">Close</Button>
            </div>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={rawGraphql} onChange={(e) => setRawGraphql(e.target.checked)} /> Raw GraphQL
              </label>
            </div>
            <textarea value={queryText} onChange={(e) => setQueryText(e.target.value)} className="border-2 border-black w-full h-24 rounded p-2 text-sm" />
            <div className="flex items-center gap-2">
              <Button onClick={runQuery} disabled={!ready || loading} className="border-2 border-black">{loading ? 'Fetching...' : 'Run Query'}</Button>
              <Button onClick={() => setResp('')} variant="outline" className="border-2 border-black">Clear</Button>
              <Button onClick={async () => { try { await navigator.clipboard.writeText(resp); } catch {} }} variant="outline" className="border-2 border-black">Copy</Button>
            </div>
            <div className="h-56 overflow-auto border-2 border-black rounded p-2 bg-black/5 text-xs whitespace-pre-wrap">{resp || 'No response'}</div>
            <div className="text-xs text-black/60">Ctrl+D to toggle</div>
          </div>
        </div>
      )}
    </div>
  );
}
