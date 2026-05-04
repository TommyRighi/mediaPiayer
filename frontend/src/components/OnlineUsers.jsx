import { useState, useEffect } from 'react';
import { api } from '../api';

const MAX_VISIBLE = 5;

export default function OnlineUsers() {
  const [users, setUsers] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetch() {
      try {
        const data = await api.auth.online();
        if (mounted) setUsers(data.users || []);
      } catch {/* ignore */}
    }

    fetch();
    const interval = setInterval(fetch, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (users.length === 0) return null;

  const visible = expanded ? users : users.slice(0, MAX_VISIBLE);
  const remaining = users.length - MAX_VISIBLE;

  return (
    <div className="hidden md:flex items-center gap-1">
      <div className="flex items-center -space-x-2">
        {visible.map((u) => (
          <div
            key={u.id}
            title={u.display_name}
            className="relative w-8 h-8 rounded-full border-2 border-neutral-900 overflow-hidden flex-shrink-0"
          >
            {u.avatar_url ? (
              <img
                src={u.avatar_url}
                alt={u.display_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-red-600 flex items-center justify-center text-white text-[11px] font-bold">
                {u.display_name?.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border border-neutral-900" />
          </div>
        ))}
      </div>
      {!expanded && remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-gray-400 hover:text-white transition ml-1 whitespace-nowrap"
        >
          +{remaining}
        </button>
      )}
      {expanded && users.length > MAX_VISIBLE && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-gray-400 hover:text-white transition ml-1"
        >
          less
        </button>
      )}
    </div>
  );
}