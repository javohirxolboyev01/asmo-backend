// src/utils/schemas.ts — zod schemas shared across more than one module.
import { z } from "zod";

export const avatarSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .max(2_000_000)
    .nullable()
    .refine(
      (value) =>
        value === null ||
        /^https?:\/\/|^data:image\/[a-z0-9.+-]+;base64,/.test(value),
      "Avatar must be an http(s) URL or supported image data URL",
    ),
);

export const gradeBody = z.object({
  score: z.coerce.number().int().min(0),
  feedback: z.string().max(5000).optional(),
});

export const paymentData = z.object({
  amount: z.number().int().positive(),
  status: z.enum(["PAID", "PENDING", "OVERDUE", "CANCELLED"]).optional(),
  paymentType: z.enum(["CASH", "CLICK", "PAYME", "BANK", "UZUM"]),
  description: z.string().max(500).nullable().optional(),
  dueDate: z.coerce.date(),
  paidAt: z.coerce.date().nullable().optional(),
});

export const studentCreate = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phone: z.string().optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});
