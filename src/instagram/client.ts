import { z } from "zod";

const mediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  // Omitted for some videos (licensed audio) and reels with downloads disabled.
  media_url: z.string().optional(),
  permalink: z.string(),
  timestamp: z.string(),
  children: z
    .object({ data: z.array(z.object({ media_type: z.string(), media_url: z.string().optional() })) })
    .optional(),
});

const responseSchema = z.object({
  business_discovery: z.object({
    media: z.object({
      data: z.array(mediaSchema),
      paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional() }).optional(),
    }),
  }),
});

export type InstagramMedia = z.infer<typeof mediaSchema>;

// Account collected by default (pipeline, collector, admin menu); override with IG_TARGET_USERNAME or --account.
export const DEFAULT_TARGET_USERNAME = "bursalokerlombok";

// Instagram usernames: letters, digits, "." and "_", up to 30 characters. Checked before the name is put
// into a Graph API field expansion, where other characters could change the query.
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

// User input such as " @lokerlombok " -> "lokerlombok".
export const instagramUsername = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(z.string().regex(USERNAME, "not a valid Instagram username"));

export class InstagramApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

export interface InstagramClientOptions {
  igUserId: string;
  accessToken: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const MEDIA_FIELDS = "id,caption,media_type,media_url,permalink,timestamp,children{media_type,media_url}";

// Reads another professional account's recent media via Business Discovery.
export function createInstagramClient({ igUserId, accessToken, fetch: doFetch = fetch, timeoutMs = 30_000 }: InstagramClientOptions) {
  return {
    async fetchRecentMedia(username: string, opts: { limit: number; after?: string }) {
      if (!USERNAME.test(username)) {
        throw new Error(`"${username}" is not a valid Instagram username`);
      }
      const media = `media.limit(${opts.limit})${opts.after ? `.after(${opts.after})` : ""}{${MEDIA_FIELDS}}`;
      const fields = `business_discovery.username(${username}){${media}}`;
      const url = `https://graph.facebook.com/${igUserId}?fields=${encodeURIComponent(fields)}`;

      // Token in a header so it never ends up in URLs or error messages.
      const signal = AbortSignal.timeout(timeoutMs);
      const timedOut = () => new InstagramApiError(408, undefined, `Instagram request timed out after ${timeoutMs}ms`);
      const res = await doFetch(url, { signal, headers: { Authorization: `Bearer ${accessToken}` } }).catch((err) => {
        throw signal.aborted ? timedOut() : err;
      });
      // Gateways can answer with HTML (e.g. 502); keep the real status instead of a JSON parse error.
      const body = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
      if (!res.ok) {
        throw new InstagramApiError(res.status, body?.error?.code, body?.error?.message ?? `Instagram API error (HTTP ${res.status})`);
      }
      if (body === null) throw signal.aborted ? timedOut() : new InstagramApiError(res.status, undefined, "Instagram response is not JSON");

      const { media: page } = responseSchema.parse(body).business_discovery;
      return { media: page.data, after: page.paging?.cursors?.after };
    },
  };
}

export type InstagramClient = ReturnType<typeof createInstagramClient>;
