import { Timer, Copy, Check, LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

interface GameHeaderProps {
  round: number;
  totalRounds: number;
  timeLeft: number;
  hostChainId?: string;
  onLeave: () => void;
}

export function GameHeader({ round, totalRounds, timeLeft, hostChainId, onLeave }: GameHeaderProps) {
  const [copied, setCopied] = useState(false);

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
          {hostChainId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyChainId}
              className="border-white/20 hover:bg-white/10 text-white hover:text-white h-8"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Chain ID: {hostChainId}
                </>
              )}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-6">
          {/* Leave Room button replaces word hints UI */}
          <Button
            variant="outline"
            size="sm"
            onClick={onLeave}
            className="border-white/20 hover:bg-white/10 text-white hover:text-white h-8"
            title="Leave Room"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Leave Room
          </Button>

          <div className="flex items-center gap-2 bg-red-500 px-4 py-2 rounded-lg">
            <Timer className="w-5 h-5" />
            <span className="tabular-nums min-w-[3ch]">{timeLeft}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}