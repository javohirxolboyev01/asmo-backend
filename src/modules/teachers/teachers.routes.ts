import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";
import { register } from "../auth/auth.service.js";

const staff = ["TEACHER", "ADMIN"];

export const teachersRouter = Router();

teachersRouter.get(
  "/teachers",
  requireAuth,
  requireRole(...staff),
  asyncRoute(async (_req: any, res: any) => {
    const rows = await prisma.teacher.findMany({ include: { Group: true } });
    const users = await prisma.user.findMany({
      where: { id: { in: rows.flatMap((x) => (x.userId ? [x.userId] : [])) } },
      select: { id: true, email: true },
    });
    const emails = new Map(users.map((user) => [user.id, user.email]));
    res.json({
      teachers: rows.map((x) => ({
        id: x.id,
        fullName: x.fullName,
        avatar: x.avatar,
        email: x.userId ? emails.get(x.userId) : undefined,
        userId: x.userId,
        groupsCount: x.Group.length,
      })),
    });
  }),
);

teachersRouter.post(
  "/teachers",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z
        .object({
          fullName: z.string().min(2),
          avatar: z.string().optional(),
          email: z.string().email().optional(),
          password: z.string().min(6).optional(),
        })
        .refine((x) => (!x.email && !x.password) || (x.email && x.password), "Email and password are required together"),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    let userId: string | undefined;
    if (req.body.email) {
      const result = await register({
        email: req.body.email,
        password: req.body.password,
        firstName: req.body.fullName.split(" ")[0],
        lastName: req.body.fullName.split(" ").slice(1).join(" ") || "Teacher",
        role: "teacher",
      });
      userId = result.user.id;
    }
    const linked = userId ? await prisma.teacher.findUnique({ where: { userId } }) : null;
    const teacher = linked
      ? await prisma.teacher.update({ where: { id: linked.id }, data: { fullName: req.body.fullName, avatar: req.body.avatar } })
      : await prisma.teacher.create({ data: { id: newId(), fullName: req.body.fullName, avatar: req.body.avatar } });
    res.status(201).json(teacher);
  }),
);

teachersRouter.patch(
  "/teachers/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({ fullName: z.string().min(2).optional(), avatar: z.string().nullable().optional() }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(await prisma.teacher.update({ where: { id: req.params.id }, data: req.body })),
  ),
);

teachersRouter.delete(
  "/teachers/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (await prisma.group.count({ where: { teacherId: req.params.id } }))
      return res.status(400).json({ error: "Teacher still has groups" });
    await prisma.teacher.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
