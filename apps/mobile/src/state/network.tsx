import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { useSession } from "./session";

const OnlineContext = createContext(true);

/**
 * Online/offline state from the OS. When the phone comes back online, queued chat messages
 * are sent. Screens use `useOnline()` to explain what works offline instead of failing.
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const { platform, outbox } = useSession();
  const [online, setOnline] = useState(true);

  useEffect(() => platform.network.subscribe(setOnline), [platform]);

  useEffect(() => {
    if (online && outbox) void outbox.flush().catch(() => undefined);
  }, [online, outbox]);

  return <OnlineContext value={online}>{children}</OnlineContext>;
}

export function useOnline(): boolean {
  return useContext(OnlineContext);
}
