import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";
import { teacherId } from "../../utils/teacherScope.js";

export const teacherCoinsRouter = Router();

teacherCoinsRouter.post(
  "/teacher/coins",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(
    z.object({
      body: z.object({
        studentId: z.string(),
        amount: z.number().int().min(-1000).max(1000),
        reason: z.string().min(1).max(200),
        sourceType: z.enum(["ATTENDANCE", "HOMEWORK", "BONUS", "PENALTY"]),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const groups = await prisma.group.findMany({ where: { teacherId: await teacherId(req) }, select: { id: true } });
    const enrolled = await prisma.enrollment.findFirst({
      where: { studentId: req.body.studentId, groupId: { in: groups.map((group) => group.id) } },
    });
    if (!enrolled) return res.status(403).json({ error: "Student is not in your groups" });
    res.status(201).json(await prisma.coinTransaction.create({ data: { id: newId(), ...req.body } }));
  }),
);
