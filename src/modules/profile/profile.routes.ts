import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, validate } from "../../middleware/index.js";
import { publicUser } from "../../utils/serializers.js";
import { uid } from "../../utils/teacherScope.js";
import { avatarSchema } from "../../utils/schemas.js";

export const profileRouter = Router();

const profileSchema = z.object({
  body: z
    .object({
      firstName: z.string().min(2).max(80).optional(),
      lastName: z.string().min(2).max(80).optional(),
      phone: z.string().max(30).nullable().optional(),
      avatar: avatarSchema.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, "At least one profile field is required"),
  params: z.object({}),
  query: z.object({}),
});

const emailSchema = z.object({
  body: z.object({ email: z.string().email() }),
  params: z.object({}),
  query: z.object({}),
});

const passwordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(128),
  }),
  params: z.object({}),
  query: z.object({}),
});

profileRouter.patch(
  "/profile",
  requireAuth,
  validate(profileSchema),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({ where: { id: uid(req) }, data: req.body, select: publicUser });
    res.json(user);
  }),
);

profileRouter.patch(
  "/settings/email",
  requireAuth,
  validate(emailSchema),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({
      where: { id: uid(req) },
      data: { email: req.body.email },
      select: publicUser,
    });
    await prisma.refreshToken.updateMany({ where: { userId: uid(req) }, data: { revokedAt: new Date() } });
    res.json({ user, message: "Email updated. Please log in again." });
  }),
);

profileRouter.patch(
  "/settings/password",
  requireAuth,
  validate(passwordSchema),
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    if (!(await bcrypt.compare(req.body.currentPassword, current.passwordHash)))
      return res.status(400).json({ error: "Current password is incorrect" });
    await prisma.user.update({
      where: { id: current.id },
      data: { passwordHash: await bcrypt.hash(req.body.newPassword, 12) },
    });
    await prisma.refreshToken.updateMany({ where: { userId: current.id }, data: { revokedAt: new Date() } });
    res.json({ success: true, message: "Password updated. Please log in again." });
  }),
);
