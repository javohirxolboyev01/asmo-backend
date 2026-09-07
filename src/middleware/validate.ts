import { z } from "zod";
import type { RequestHandler } from "express";

export const validate = (schema: z.ZodType): RequestHandler => (req, res, next) => {
  const parsed = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue?.message ?? "Validation failed", details: parsed.error.flatten() });
  }
  req.body = (parsed.data as any).body;
  next();
};

/** Common param-only validator: `{ id: string }` in params, empty body/query. */
export const idSchema = z.object({
  body: z.record(z.string(), z.unknown()).default({}),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});
