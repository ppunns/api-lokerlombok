import { SQL } from "bun";

// Connection budget on the Supabase session pooler, where every client connection holds a
// server connection. During a zero-downtime deploy the old and new API instance overlap, so the
// API counts twice: 2 × API 2 + pipeline 2 + one CLI script 2 = 8, below the pool size (15).
// Two API instances also fit the api_readonly role's connection limit (5).
export const POOL_MAX = { api: 2, worker: 2 } as const;

export function connectDb(url: string, max: number): SQL {
  // Idle connections are released so a sleeping pipeline does not hold pooler slots.
  return new SQL({ url, max, idleTimeout: 60, connectionTimeout: 10 });
}
