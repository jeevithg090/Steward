import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../types/types";
import { AudioMessage } from "./AudioMessage";

interface TaskMessagesProps {
  messages: ChatMessage[];
}

export function TaskMessages({ messages }: TaskMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto pb-28 pr-1">
      {messages.map((message) => {
        const isUser = message.role === "user";
        return (
          <div
            key={message.id}
            className={`max-w-[85%] rounded-2xl bg-nexus-card px-4 py-3 text-sm text-white ${
              isUser ? "ml-auto rounded-br-sm" : "rounded-bl-sm"
            }`}
          >
            {message.audio ? <AudioMessage audio={message.audio} /> : message.text}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}