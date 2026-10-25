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
}

const MEDIA_FIELDS = "id,caption,media_type,media_url,permalink,timestamp,children{media_type,media_url}";

// Reads another professional account's recent media via Business Discovery.
export function createInstagramClient({ igUserId, accessToken, fetch: doFetch = fetch }: InstagramClientOptions) {
  return {
    async fetchRecentMedia(username: string, opts: { limit: number; after?: string }) {
      const media = `media.limit(${opts.limit})${opts.after ? `.after(${opts.after})` : ""}{${MEDIA_FIELDS}}`;
      const fields = `business_discovery.username(${username}){${media}}`;
      const url = `https://graph.facebook.com/${igUserId}?fields=${encodeURIComponent(fields)}`;

      // Token in a header so it never ends up in URLs or error messages.
      const res = await doFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = (await res.json()) as { error?: { code?: number; message?: string } };
      if (!res.ok) {
        throw new InstagramApiError(res.status, body.error?.code, body.error?.message ?? "Instagram API error");
      }

      const { media: page } = responseSchema.parse(body).business_discovery;
      return { media: page.data, after: page.paging?.cursors?.after };
    },
  };
}

export type InstagramClient = ReturnType<typeof createInstagramClient>;
