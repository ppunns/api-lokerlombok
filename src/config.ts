import { z } from "zod";

// "https://a.com,http://localhost:5173" -> exact origins (scheme + host + optional port, no path).
const originList = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^https?:\/\/[^/\s]+$/, "must be an origin like https://example.com")).min(1));

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string");

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Admin connection (Supabase session pooler, full access): pipeline and scripts only.
    DATABASE_URL: postgresUrl.optional(),
    // Read-only role for the public API (migration create_api_readonly_role). Unset = DATABASE_URL.
    // A deployed API should get only this one, never DATABASE_URL.
    API_DATABASE_URL: postgresUrl.optional(),
    // Browser origins allowed to call the API. Unset = any origin (public, read-only, no credentials).
    CORS_ORIGINS: originList.optional(),
  })
  .refine((env) => env.DATABASE_URL || env.API_DATABASE_URL, {
    message: "set API_DATABASE_URL (API) or DATABASE_URL (pipeline and scripts)",
    path: ["DATABASE_URL"],
  });

export function parseConfig(env: Record<string, string | undefined>) {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    apiDatabaseUrl: (parsed.API_DATABASE_URL ?? parsed.DATABASE_URL)!,
    // For the pipeline and admin scripts, which need write access.
    adminDatabaseUrl(): string {
      if (!parsed.DATABASE_URL) throw new Error("DATABASE_URL is required for the pipeline and admin scripts");
      return parsed.DATABASE_URL;
    },
  };
}

export const config = parseConfig(Bun.env);
