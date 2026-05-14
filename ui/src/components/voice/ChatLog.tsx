import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/Utils";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  /** Agent-only: collapsed reasoning text, appended as it arrives. */
  thinking?: string;
  /** Stable transcript message ID sent by the server for chunk grouping. */
  messageId?: string;
  /** When true, this bubble's turn is finished — new agent/user chunks should
   *  start a new bubble even if the role matches. */
  final?: boolean;
  /** Optional UI marker for non-standard user bubbles (e.g. local notices). */
  kind?: "clarification";
  ts: number;
}

interface ChatLogProps {
  messages: ChatMessage[];
}

export default function ChatLog({ messages }: ChatLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="flex max-w-[260px] flex-col items-center gap-2 text-center">
          <p className="text-xs italic text-slate-400">Conversation will appear here.</p>
          <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600">
            "find movies about a heist gone wrong"
          </span>
          <p className="text-[11px] text-slate-400">Try this once you're connected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      {messages.map((msg, i) => (
        <ChatBubble key={msg.messageId ?? `${msg.role}-${msg.ts}-${i}`} msg={msg} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [showThinking, setShowThinking] = useState(false);
  const hasText = !!msg.text.trim();
  const hasThinking = !!msg.thinking?.trim();
  const isClarification = msg.kind === "clarification";

  // Don't render an empty bubble while a chunk has only arrived for thinking.
  if (!hasText && !hasThinking) return null;

  return (
    <div
      className={cn(
        "flex max-w-[92%] min-w-0 flex-col gap-0.5 break-words rounded-[10px] px-3 py-2 text-sm leading-snug",
        msg.role === "user"
          ? // Soft Gemini blue, speech-bubble corner on the bottom-right side.
            "self-end rounded-br-[3px] bg-[#e8f0fe] text-slate-900"
          : // Soft Gemini purple, speech-bubble corner on the bottom-left side.
            "self-start rounded-bl-[3px] bg-[#f3e8fd] text-slate-900",
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {msg.role === "user" ? "You" : "Gemini"}
      </div>
      {/* Thinking renders ABOVE the spoken text so the toggle stays in a
          stable position while transcript chunks continue to arrive below. */}
      {hasThinking && msg.role === "agent" && (
        <>
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            className="self-start text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            {showThinking ? "Hide thinking" : "Show thinking"}
          </button>
          {showThinking && (
            <div className="mb-0.5 max-h-52 overflow-y-auto whitespace-pre-wrap rounded bg-black/5 p-2 text-[12px] leading-relaxed text-slate-600">
              {msg.thinking}
            </div>
          )}
        </>
      )}
      {hasText && (
        <div
          className={cn(
            "whitespace-pre-wrap break-words",
            isClarification && "italic text-slate-500",
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
