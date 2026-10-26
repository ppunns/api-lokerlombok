import { z } from "zod";

// "https://a.com,http://localhost:5173" -> exact origins (scheme + host + optional port, no path).
const originList = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^https?:\/\/[^/\s]+$/, "must be an origin like https://example.com")).min(1));

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string");

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Postgres connection string (Supabase session pooler); server-side only.
  DATABASE_URL: postgresUrl,
  // Optional read-only role for the public API (migration create_api_readonly_role). Unset = DATABASE_URL.
  API_DATABASE_URL: postgresUrl.optional(),
  // Browser origins allowed to call the API. Unset = any origin (public, read-only, no credentials).
  CORS_ORIGINS: originList.optional(),
});

export const config = envSchema.parse(Bun.env);
