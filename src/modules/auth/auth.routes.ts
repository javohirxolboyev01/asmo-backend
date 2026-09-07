import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, validate } from "../../middleware/index.js";
import { publicUser, userSummary } from "../../utils/serializers.js";
import { uid } from "../../utils/teacherScope.js";
import { authenticate, issueAccessToken, issueRefreshToken, register } from "./auth.service.js";

export const authRouter = Router();

export const authSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(6),
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    phone: z.string().optional(),
    role: z.enum(["student", "teacher"]).optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

authRouter.post(
  "/auth/register",
  validate(authSchema),
  asyncRoute(async (req: any, res: any) =>
    res.status(201).json(
      await register({
        ...req.body,
        firstName: req.body.firstName ?? "Student",
        lastName: req.body.lastName ?? "User",
        // Public self-registration is always a student account. Teacher
        // accounts are created only via the staff-only POST /teachers route.
        role: "student",
      }),
    ),
  ),
);

authRouter.post(
  "/auth/login",
  validate(authSchema),
  asyncRoute(async (req: any, res: any) => {
    const result = await authenticate(req.body.email, req.body.password);
    if (!result) return res.status(401).json({ error: "Email or password is incorrect" });
    res.json(result);
  }),
);

authRouter.post(
  "/auth/refresh",
  asyncRoute(async (req: any, res: any) => {
    try {
      const hash = crypto.createHash("sha256").update(req.body.refreshToken ?? "").digest("hex");
      const token = await prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { User: true } });
      if (!token || token.revokedAt || token.expiresAt < new Date())
        return res.status(401).json({ error: "Invalid refresh token" });
      await prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
      res.json({
        user: await prisma.user.findUniqueOrThrow({ where: { id: token.userId }, select: publicUser }),
        accessToken: issueAccessToken(token.User),
        refreshToken: await issueRefreshToken(token.userId),
      });
    } catch {
      res.status(401).json({ error: "Invalid refresh token" });
    }
  }),
);

authRouter.get(
  "/auth/me",
  requireAuth,
  asyncRoute(async (req: any, res: any) =>
    res.json(userSummary(await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } }))),
  ),
);
