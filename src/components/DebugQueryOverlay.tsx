import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface DebugQueryOverlayProps {
  application?: any;
  client?: any;
  ready: boolean;
  defaultQuery: string;
  title?: string;
}

export function DebugQueryOverlay({ application, client, ready, defaultQuery, title }: DebugQueryOverlayProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [resp, setResp] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const debounceRef = useRef<number | null>(null);

  const runQuery = async () => {
    if (!application || !ready) return;
    setLoading(true);
    try {
      const res = await application.query(query);
      const txt = typeof res === "string" ? res : JSON.stringify(res);
      setResp(txt);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!client || !application || !ready || !auto) return;
    const debounced = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      debounceRef.current = window.setTimeout(() => {
        runQuery();
      }, 300);
    };
    const unsub = client?.onNotification?.(debounced);
    debounced();
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (typeof unsub === "function") {
        try { unsub(); } catch {}
      } else {
        try { client?.offNotification?.(debounced); } catch {}
      }
    };
  }, [client, application, ready, auto, query]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!open ? (
        <Button onClick={() => setOpen(true)} className="border-2 border-black bg-black text-white">
          Debug
        </Button>
      ) : (
        <div className="w-[360px] bg-white border-2 border-black rounded-lg shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 bg-black text-white rounded-t-lg">
            <span>{title || "Room Query"}</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
              </label>
              <Button onClick={() => setOpen(false)} variant="outline" className="border-2 border-white text-white">
                Close
              </Button>
            </div>
          </div>
          <div className="p-3 space-y-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} className="border-2 border-black" />
            <div className="flex items-center gap-2">
              <Button onClick={runQuery} disabled={!ready || loading} className="border-2 border-black">
                {loading ? "Fetching..." : "Run Query"}
              </Button>
              <Button onClick={() => setResp("")} variant="outline" className="border-2 border-black">
                Clear
              </Button>
              <Button onClick={async () => { try { await navigator.clipboard.writeText(resp); } catch {} }} variant="outline" className="border-2 border-black">
                Copy
              </Button>
            </div>
            <div className="h-48 overflow-auto border-2 border-black rounded p-2 bg-black/5 text-xs whitespace-pre-wrap">
              {resp || "No response"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

