import { z } from "zod";

// Enum values must stay in sync with the CHECK constraints in supabase/migrations.
export const employmentTypes = ["full_time", "part_time", "contract", "internship", "freelance"] as const;
export const educationLevels = ["sd", "smp", "sma_smk", "d1", "d2", "d3", "d4", "s1", "s2", "s3"] as const;
export const sourcePlatforms = ["instagram"] as const;
export const extractionStatuses = ["pending", "extracted", "failed"] as const;
export const publicationStatuses = ["draft", "published", "rejected", "expired"] as const;

const text = z.string().trim().min(1);
// Optional fields: missing or unknown information is stored as null, never guessed.
const optionalText = text.nullable().default(null);
const salary = z.number().int().nonnegative().nullable().default(null);

const jobFields = z.object({
  title: text,
  company_name: optionalText,
  location: optionalText,
  description: optionalText,
  requirements: z.array(text).nullable().default(null),
  employment_type: z.enum(employmentTypes).nullable().default(null),
  education_level: z.enum(educationLevels).nullable().default(null),
  salary_min: salary,
  salary_max: salary,
  salary_text: optionalText,
  deadline: z.iso.date().nullable().default(null),
  source_platform: z.enum(sourcePlatforms).default("instagram"),
  source_account: text,
  source_post_url: z.url({ protocol: /^https$/ }),
  source_post_id: text,
  // Position of this job within its source post (0-based); one post can list several jobs.
  source_job_index: z.number().int().nonnegative().default(0),
  source_posted_at: z.iso.datetime({ offset: true }).nullable().default(null),
  raw_caption: optionalText,
  ocr_text: optionalText,
  extraction_status: z.enum(extractionStatuses).default("pending"),
  publication_status: z.enum(publicationStatuses).default("draft"),
});

const salaryRange = {
  check: (job: { salary_min: number | null; salary_max: number | null }) =>
    job.salary_min === null || job.salary_max === null || job.salary_min <= job.salary_max,
  params: { message: "salary_min must not exceed salary_max", path: ["salary_min"] },
};

export const jobInsertSchema = jobFields.strict().refine(salaryRange.check, salaryRange.params);
export const jobInsertColumns = Object.keys(jobFields.shape) as (keyof JobInsert)[];

export const jobSchema = jobFields
  .extend({
    id: z.uuid(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .refine(salaryRange.check, salaryRange.params);

// Blank query params (e.g. `?q=`) are treated as absent.
const searchText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  text.max(100).optional(),
);

export const jobSearchQuerySchema = z.object({
  q: searchText,
  location: searchText,
  employment_type: z.enum(employmentTypes).optional(),
  education_level: z.enum(educationLevels).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type JobInsert = z.infer<typeof jobInsertSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobSearchQuery = z.infer<typeof jobSearchQuerySchema>;
// Fields exposed by the public API; source text and statuses stay internal.
export type PublicJob = Omit<Job, "raw_caption" | "ocr_text" | "extraction_status" | "publication_status">;
