import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";
import { teacherGroup, teacherId } from "../../utils/teacherScope.js";

export const teacherLessonsRouter = Router();

const lessonCreate = z.object({
  body: z.object({
    groupId: z.string(),
    lessonOrder: z.number().int().positive(),
    lessonDate: z.coerce.date(),
    topic: z.string().min(1).max(200),
    status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

teacherLessonsRouter.post(
  "/teacher/lessons",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(lessonCreate),
  asyncRoute(async (req: any, res: any) => {
    if (!(await teacherGroup(req, req.body.groupId)))
      return res.status(403).json({ error: "You do not own this group" });
    const lesson = await prisma.lesson.create({ data: { id: newId(), ...req.body } });
    res.status(201).json(lesson);
  }),
);

teacherLessonsRouter.patch(
  "/teacher/lessons/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(
    z.object({
      body: z.object({
        lessonDate: z.coerce.date().optional(),
        topic: z.string().min(1).max(200).optional(),
        status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const lesson = await prisma.lesson.findFirst({ where: { id: req.params.id, Group: { teacherId: await teacherId(req) } } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    res.json(await prisma.lesson.update({ where: { id: lesson.id }, data: req.body }));
  }),
);
