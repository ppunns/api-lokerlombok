import { describe, expect, test } from "bun:test";
import { parseConfig } from "./config";

const ADMIN = "postgresql://postgres.ref:pw@pooler.example:5432/postgres";
const API = "postgresql://api_readonly.ref:pw@pooler.example:5432/postgres";

describe("parseConfig", () => {
  test("API-only environment: no admin credentials needed", () => {
    const config = parseConfig({ API_DATABASE_URL: API });
    expect(config.apiDatabaseUrl).toBe(API);
    expect(() => config.adminDatabaseUrl()).toThrow("DATABASE_URL is required");
  });

  test("API prefers the read-only URL when both are set", () => {
    const config = parseConfig({ DATABASE_URL: ADMIN, API_DATABASE_URL: API });
    expect(config.apiDatabaseUrl).toBe(API);
    expect(config.adminDatabaseUrl()).toBe(ADMIN);
  });

  test("falls back to DATABASE_URL for local development", () => {
    expect(parseConfig({ DATABASE_URL: ADMIN }).apiDatabaseUrl).toBe(ADMIN);
  });

  test("fails fast when no database URL is set", () => {
    expect(() => parseConfig({})).toThrow("set API_DATABASE_URL");
  });

  test("rejects non-postgres URLs and parses PORT and CORS_ORIGINS", () => {
    expect(() => parseConfig({ API_DATABASE_URL: "mysql://x" })).toThrow();
    const config = parseConfig({ API_DATABASE_URL: API, PORT: "10000", CORS_ORIGINS: "https://a.com, http://localhost:5173" });
    expect(config.PORT).toBe(10000);
    expect(config.CORS_ORIGINS).toEqual(["https://a.com", "http://localhost:5173"]);
  });
});
