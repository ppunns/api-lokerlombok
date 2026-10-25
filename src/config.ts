import { z } from "zod";

// "https://a.com,http://localhost:5173" -> exact origins (scheme + host + optional port, no path).
const originList = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^https?:\/\/[^/\s]+$/, "must be an origin like https://example.com")).min(1));

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Postgres connection string (Supabase session pooler); server-side only.
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  // Browser origins allowed to call the API. Unset = any origin (public, read-only, no credentials).
  CORS_ORIGINS: originList.optional(),
});

export const config = envSchema.parse(Bun.env);
