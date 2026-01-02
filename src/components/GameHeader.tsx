import { Timer, Loader2 } from "lucide-react";
import { useState } from "react";

interface GameHeaderProps {
  round: number;
  totalRounds: number;
  timeLeft: number;
  currentWord?: string;
  isDrawing?: boolean;
  hostChainId?: string;
  onLeave: () => void;
}

export function GameHeader({ round, totalRounds, timeLeft, currentWord, isDrawing, hostChainId, onLeave }: GameHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const handleCopyChainId = async () => {
    if (!hostChainId) return;
    try {
      await navigator.clipboard.writeText(hostChainId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="bg-black text-white px-6 py-4 shadow-lg">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-red-500">SKRIBBL</h1>
          <div className="text-white/80">
            Round {round} of {totalRounds}
          </div>
          {isDrawing && currentWord && (
            <div className="text-white/80">
              Word: <span className="text-white">{currentWord}</span>
            </div>
          )}
          {hostChainId && (
            <span
              onClick={handleCopyChainId}
              className="text-white text-sm cursor-pointer select-text"
              title="Copy Chain ID"
            >
              {copied ? "Copied!" : `Chain ID: ${hostChainId}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={async () => {
              if (leaving) return;
              setLeaving(true);
              try {
                await onLeave();
              } finally {
                setLeaving(false);
              }
            }}
            className="px-4 py-2 bg-white text-black border-2 border-gray-400 rounded-lg hover:bg-black hover:text-white transition-all text-sm inline-flex items-center gap-2 disabled:opacity-50"
            disabled={leaving}
            title="Leave Room"
          >
            {leaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Leave Room
          </button>

          <div className="flex items-center gap-2 bg-red-500 px-4 py-2 rounded-lg">
            <Timer className="w-5 h-5" />
            <span className="tabular-nums min-w-[3ch]">{timeLeft}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
