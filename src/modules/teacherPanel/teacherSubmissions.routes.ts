import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { publicUser } from "../../utils/serializers.js";
import { gradeBody } from "../../utils/schemas.js";
import { groupScope } from "../../utils/teacherScope.js";

export const teacherSubmissionsRouter = Router();

teacherSubmissionsRouter.get(
  "/teacher/submissions",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.submission.findMany({
        where: {
          Homework: { Lesson: { Group: await groupScope(req) } },
          ...(req.query.status ? { status: String(req.query.status) } : {}),
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

teacherSubmissionsRouter.get(
  "/teacher/submissions/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.id, Homework: { Lesson: { Group: await groupScope(req) } } },
      include: {
        User: { select: publicUser },
        Homework: { include: { Lesson: { include: { Group: true } } } },
      },
    });
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    res.json(submission);
  }),
);

teacherSubmissionsRouter.patch(
  "/teacher/submissions/:id/grade",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(z.object({ body: gradeBody, params: z.object({ id: z.string() }), query: z.object({}) })),
  asyncRoute(async (req: any, res: any) => {
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.id, Homework: { Lesson: { Group: await groupScope(req) } } },
    });
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    const homework = await prisma.homework.findUniqueOrThrow({ where: { id: submission.homeworkId } });
    if (req.body.score > homework.maxScore) return res.status(400).json({ error: "Score cannot exceed maxScore" });
    res.json(
      await prisma.submission.update({
        where: { id: submission.id },
        data: { score: req.body.score, feedback: req.body.feedback, status: "GRADED", gradedAt: new Date() },
      }),
    );
  }),
);
