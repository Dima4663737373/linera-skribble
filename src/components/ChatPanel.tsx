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

export function ChatPanel({ messages, onSendMessage, isDrawing, hasGuessed, className }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef<boolean>(true);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isDrawing || hasGuessed) return;

    onSendMessage(inputValue);
    setInputValue("");
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
            <span>{message.message}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t-2 border-black">
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
