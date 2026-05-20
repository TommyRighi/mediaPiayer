import { useState, useEffect, useRef } from 'react';

export default function ChatPanel({ messages, onSend, currentUserId }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto space-y-2 mb-2 min-h-0" style={{ maxHeight: '300px' }}>
        {messages.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-4">No messages yet</p>
        )}
        {messages.map((msg, i) => {
          const isMine = msg.userId === currentUserId;
          return (
            <div key={i} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              {!isMine && (
                <span className="text-xs text-gray-500 px-1 mb-0.5">{msg.displayName}</span>
              )}
              <div className={`px-2 py-1 rounded text-sm max-w-full break-words ${
                isMine
                  ? 'bg-red-700 text-white rounded-br-sm'
                  : 'bg-neutral-800 text-gray-200 rounded-bl-sm'
              }`}>
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
              <span className="text-xs text-gray-600 mt-0.5 px-1">{formatTime(msg.timestamp)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-1.5 border-t border-neutral-800 pt-2">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          maxLength={500}
          className="flex-1 bg-neutral-800 text-white text-sm rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-red-600 placeholder-gray-600"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-red-700 hover:bg-red-600 disabled:bg-neutral-800 disabled:text-gray-600 text-white text-sm rounded px-3 py-1.5 transition font-medium"
        >
          Send
        </button>
      </form>
    </div>
  );
}
