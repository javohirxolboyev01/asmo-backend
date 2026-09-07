import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";

export const teacherHomeworkRouter = Router();

teacherHomeworkRouter.post(
  "/teacher/homework",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(
    z.object({
      body: z.object({
        lessonId: z.string(),
        title: z.string().min(1).max(200),
        description: z.string().max(10000).optional(),
        deadline: z.coerce.date(),
        maxScore: z.number().int().positive().optional(),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const lesson = await prisma.lesson.findUnique({ where: { id: req.body.lessonId } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    const homework = await prisma.homework.create({ data: { id: newId(), ...req.body } });
    res.status(201).json(homework);
  }),
);
