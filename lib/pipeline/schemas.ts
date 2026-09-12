import { z } from "zod";

// Kept constraint-free so both providers' structured-output modes accept them; limits are enforced in code.
export const ExtractSchema = z.object({
  units: z.array(z.object({ answer: z.string(), evidence: z.array(z.string()) })),
});

export const QuestionsSchema = z.object({
  items: z.array(z.object({ id: z.string(), questions: z.array(z.string()) })),
});
