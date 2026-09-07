import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { publicUser } from "../../utils/serializers.js";
import { gradeBody } from "../../utils/schemas.js";
import { groupScope } from "../../utils/teacherScope.js";
import { newId } from "../../utils/ids.js";

const staff = ["TEACHER", "ADMIN"];

export const submissionsRouter = Router();

submissionsRouter.get(
  "/submissions",
  requireAuth,
  requireRole(...staff),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.submission.findMany({
        where: {
          Homework: { Lesson: { Group: await groupScope(req) } },
          ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}),
        },
        include: {
          User: { select: publicUser },
          Homework: { include: { Lesson: { include: { Group: true } } } },
        },
        orderBy: { submittedAt: "desc" },
      }),
    ),
  ),
);

submissionsRouter.patch(
  "/submissions/:id/grade",
  requireAuth,
  requireRole(...staff),
  validate(z.object({ body: gradeBody, params: z.object({ id: z.string() }), query: z.object({}) })),
  asyncRoute(async (req: any, res: any) => {
    const sub = await prisma.submission.findUnique({ where: { id: req.params.id }, include: { Homework: true } });
    if (!sub) return res.status(404).json({ error: "Submission not found" });
    if (req.body.score > sub.Homework.maxScore)
      return res.status(400).json({ error: "Score cannot exceed maxScore" });
    const updated = await prisma.submission.update({
      where: { id: sub.id },
      data: { score: req.body.score, feedback: req.body.feedback, status: "GRADED", gradedAt: new Date() },
    });
    await prisma.notification.create({
      data: {
        id: newId(),
        userId: sub.studentId,
        type: "GRADE",
        title: "Homework graded",
        message: `${req.body.score}/${sub.Homework.maxScore}`,
      },
    });
    res.json(updated);
  }),
);
