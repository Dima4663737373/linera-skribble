import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { ChatMessage } from "./Game";
import { cn } from "./ui/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isDrawing: boolean;
  hasGuessed: boolean;
  className?: string;
}

const isUrlOnly = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

const isTenorUrl = (url: string) => {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === "tenor.com" || host.endsWith(".tenor.com");
  } catch {
    return false;
  }
};

const directTenorMediaUrl = (url: string) => {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!host.endsWith("tenor.com")) return null;
    const lowerPath = u.pathname.toLowerCase();
    if (lowerPath.endsWith(".gif") || lowerPath.endsWith(".mp4") || lowerPath.endsWith(".webm")) return url;
    return null;
  } catch {
    return null;
  }
};

const extractTenorId = (url: string) => {
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().endsWith("tenor.com")) return null;
    const m = u.pathname.match(/(?:-|\/)(\d+)(?:\/)?$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
};

function TenorGif({ url, apiKey }: { url: string; apiKey?: string }) {
  const [mediaUrl, setMediaUrl] = useState<string>(() => directTenorMediaUrl(url) ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(() => (mediaUrl ? "ready" : "idle"));

  useEffect(() => {
    const direct = directTenorMediaUrl(url);
    if (direct) {
      setMediaUrl(direct);
      setStatus("ready");
      return;
    }
    const id = extractTenorId(url);
    if (!id || !apiKey) {
      setMediaUrl("");
      setStatus("error");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    fetch(`https://tenor.googleapis.com/v2/posts?ids=${encodeURIComponent(id)}&key=${encodeURIComponent(apiKey)}&media_filter=gif,tinygif`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const result = data?.results?.[0];
        const nextUrl =
          result?.media_formats?.tinygif?.url ||
          result?.media_formats?.gif?.url ||
          result?.media_formats?.mediumgif?.url ||
          "";
        if (!nextUrl) throw new Error("No media URL");
        if (cancelled) return;
        setMediaUrl(nextUrl);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMediaUrl("");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [url, apiKey]);

  if (status === "ready" && mediaUrl) {
    return <img src={mediaUrl} alt="GIF" className="max-w-[240px] max-h-[240px] rounded-md border border-black/10" loading="lazy" />;
  }

  if (status === "loading") {
    return <span className="text-sm opacity-70">Loading GIF…</span>;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="underline break-all">
      {url}
    </a>
  );
}

export function ChatPanel({ messages, onSendMessage, isDrawing, hasGuessed, className }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef<boolean>(true);
  const tenorApiKey = (import.meta as any).env?.VITE_TENOR_API_KEY as string | undefined;
  const [gifSuggestions, setGifSuggestions] = useState<Array<{ id: string; sendUrl: string; previewUrl: string }>>([]);
  const searchTimeoutRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    });
  }, [messages]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }

    const q = String(inputValue || "").trim();
    const shouldSearch =
      Boolean(tenorApiKey) &&
      !isDrawing &&
      !hasGuessed &&
      q.length >= 2 &&
      !isUrlOnly(q);

    if (!shouldSearch) {
      setGifSuggestions([]);
      return;
    }

    searchTimeoutRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${encodeURIComponent(tenorApiKey || "")}&limit=3&media_filter=tinygif,gif&contentfilter=medium`,
        { signal: controller.signal }
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => {
          const results: any[] = Array.isArray(data?.results) ? data.results : [];
          const next = results
            .map((item) => {
              const id = String(item?.id ?? "");
              const sendUrl = String(item?.itemurl ?? "");
              const previewUrl =
                String(item?.media_formats?.tinygif?.url ?? item?.media_formats?.gif?.url ?? "");
              if (!id || !sendUrl || !previewUrl) return null;
              if (!isTenorUrl(sendUrl)) return null;
              return { id, sendUrl, previewUrl };
            })
            .filter(Boolean)
            .slice(0, 3) as Array<{ id: string; sendUrl: string; previewUrl: string }>;
          setGifSuggestions(next);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setGifSuggestions([]);
        })
        .finally(() => {
          if (searchAbortRef.current === controller) {
            searchAbortRef.current = null;
          }
        });
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
    };
  }, [inputValue, tenorApiKey, isDrawing, hasGuessed]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isDrawing || hasGuessed) return;

    onSendMessage(inputValue);
    setInputValue("");
    setGifSuggestions([]);
  };

  return (
    <div className={cn("w-full bg-white border-2 border-black rounded-lg overflow-hidden flex flex-col", className)}>
      <div className="bg-black text-white px-4 py-3">
        <h2>Chat</h2>
      </div>

      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
          stickToBottomRef.current = distance < 64;
        }}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`p-2 rounded-lg ${
              message.playerId === "system"
                ? "bg-black text-white text-center text-sm"
                : message.isCorrect
                ? "bg-red-500 text-white"
                : "bg-black/5"
            }`}
          >
            {message.playerId !== "system" && (
              <span>{message.playerName}: </span>
            )}
            {(() => {
              const raw = String(message.message ?? "");
              const trimmed = raw.trim();
              if (isUrlOnly(trimmed) && isTenorUrl(trimmed)) {
                return (
                  <div className={message.playerId !== "system" ? "mt-1" : ""}>
                    <TenorGif url={trimmed} apiKey={tenorApiKey} />
                  </div>
                );
              }
              return <span className="break-words">{raw}</span>;
            })()}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t-2 border-black">
        {gifSuggestions.length > 0 && (
          <div className="mb-3 flex gap-2">
            {gifSuggestions.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  onSendMessage(g.sendUrl);
                  setInputValue("");
                  setGifSuggestions([]);
                }}
                className="rounded-md border border-black/20 bg-white hover:bg-black/5 overflow-hidden"
                aria-label="Send GIF"
              >
                <img src={g.previewUrl} alt="GIF" className="h-16 w-16 object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              isDrawing
                ? "You are drawing..."
                : hasGuessed
                ? "You guessed it!"
                : "Type your answer..."
            }
            disabled={isDrawing || hasGuessed}
            className="border-2 border-black"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isDrawing || hasGuessed || !inputValue.trim()}
            className="bg-red-500 hover:bg-red-600 border-2 border-black shrink-0"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </form>
    </div>
  );
}
