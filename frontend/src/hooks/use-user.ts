import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import type { User } from "@/src/api";

const KEY = "lastmile.user";

export function useUser() {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const raw = await storage.getItem<any>(KEY, null);
      setUserState(raw as User | null);
      setLoading(false);
    })();
  }, []);

  const setUser = useCallback(async (u: User | null) => {
    if (u) await storage.setItem(KEY, u as any);
    else await storage.removeItem(KEY);
    setUserState(u);
  }, []);

  return { user, setUser, loading };
}

export async function getStoredUser(): Promise<User | null> {
  return (await storage.getItem<any>(KEY, null)) as User | null;
}

export async function clearStoredUser() {
  await storage.removeItem(KEY);
}
