import { SQL } from "bun";

// Connection budget on the Supabase session pooler, where every client connection holds a
// server connection: API 5 + pipeline 2 + one CLI script 2 = 9, below the smallest pool size (15).
export const POOL_MAX = { api: 5, worker: 2 } as const;

export function connectDb(url: string, max: number): SQL {
  // Idle connections are released so a sleeping pipeline does not hold pooler slots.
  return new SQL({ url, max, idleTimeout: 60, connectionTimeout: 10 });
}
