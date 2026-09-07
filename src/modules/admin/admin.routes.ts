import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { publicUser, userSummary } from "../../utils/serializers.js";
import { studentCreate } from "../../utils/schemas.js";
import { uid } from "../../utils/teacherScope.js";
import { register } from "../auth/auth.service.js";

export const adminRouter = Router();

adminRouter.get(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  asyncRoute(async (_req: any, res: any) =>
    res.json({
      users: (
        await prisma.user.findMany({ select: publicUser, orderBy: { createdAt: "desc" } })
      ).map(userSummary),
    }),
  ),
);

adminRouter.post(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  validate(studentCreate),
  asyncRoute(async (req: any, res: any) => {
    const result = await register({ ...req.body, role: "student" });
    res.status(201).json(result.user);
  }),
);

adminRouter.patch(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  validate(
    z.object({
      body: z.object({
        firstName: z.string().min(2).optional(),
        lastName: z.string().min(2).optional(),
        phone: z.string().nullable().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: req.body });
    res.json(userSummary(user));
  }),
);

adminRouter.delete(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (req.params.id === uid(req)) return res.status(400).json({ error: "You cannot delete yourself" });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

adminRouter.patch(
  "/admin/users/:id/role",
  requireAuth,
  requireRole("ADMIN"),
  validate(
    z.object({
      body: z.object({ role: z.enum(["STUDENT", "TEACHER", "ADMIN"]) }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } });
    res.json(userSummary(user));
  }),
);

adminRouter.patch(
  "/admin/groups/:id/teacher",
  requireAuth,
  requireRole("ADMIN"),
  validate(
    z.object({
      body: z.object({ teacherId: z.string() }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const teacher = await prisma.teacher.findUnique({ where: { id: req.body.teacherId } });
    if (!teacher) return res.status(404).json({ error: "Teacher not found" });
    res.json(
      await prisma.group.update({
        where: { id: req.params.id },
        data: { teacherId: teacher.id },
        include: { Teacher: true, Direction: true },
      }),
    );
  }),
);
