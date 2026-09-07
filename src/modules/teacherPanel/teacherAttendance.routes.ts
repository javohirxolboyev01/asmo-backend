import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";
import { teacherId } from "../../utils/teacherScope.js";

export const teacherAttendanceRouter = Router();

const attendanceBody = z.object({
  body: z.object({
    status: z.enum(["PRESENT", "ABSENT"]),
    note: z.string().max(1000).optional(),
  }),
  params: z.object({ lessonId: z.string(), studentId: z.string() }),
  query: z.object({}),
});

teacherAttendanceRouter.put(
  "/teacher/attendance/:lessonId/:studentId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(attendanceBody),
  asyncRoute(async (req: any, res: any) => {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: req.params.lessonId,
        Group: { teacherId: await teacherId(req), Enrollment: { some: { User: { id: req.params.studentId } } } },
      },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson or student not found" });
    res.json(
      await prisma.attendanceRecord.upsert({
        where: { lessonId_studentId: { lessonId: lesson.id, studentId: req.params.studentId } },
        update: req.body,
        create: { id: newId(), lessonId: lesson.id, studentId: req.params.studentId, ...req.body },
      }),
    );
  }),
);
