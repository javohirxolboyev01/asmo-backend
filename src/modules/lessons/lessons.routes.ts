import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { lower } from "../../utils/serializers.js";
import { newId } from "../../utils/ids.js";
import { uid } from "../../utils/teacherScope.js";

const staff = ["TEACHER", "ADMIN"];

export const lessonsRouter = Router();

lessonsRouter.get(
  "/lessons/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: req.params.id,
        ...(current.role === "STUDENT" ? { Group: { Enrollment: { some: { studentId: current.id } } } } : {}),
      },
      include: {
        Group: true,
        Homework: { include: { Submission: { where: { studentId: current.id } } } },
        AttendanceRecord: true,
      },
    });
    if (!lesson)
      return res.status(current.role === "STUDENT" ? 403 : 404).json({ error: "Lesson not found or access denied" });
    const homework = lesson.Homework;
    const submission = homework?.Submission[0] ?? null;
    res.json({
      lesson: {
        id: lesson.id,
        groupId: lesson.groupId,
        topic: lesson.topic,
        description: lesson.description,
        lessonDate: lesson.lessonDate,
        lessonOrder: lesson.lessonOrder,
        groupName: lesson.Group.name,
        teacherName: "",
        status: lower(lesson.status),
      },
      homework: homework
        ? {
            id: homework.id,
            title: homework.title,
            description: homework.description,
            maxScore: homework.maxScore,
            deadline: homework.deadline,
            isOverdue: homework.deadline < new Date(),
            status: lower(homework.status),
          }
        : null,
      ...(current.role === "STUDENT"
        ? { submission: submission ? { ...submission, status: lower(submission.status) } : null }
        : { roster: lesson.AttendanceRecord }),
    });
  }),
);

lessonsRouter.patch(
  "/lessons/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        topic: z.string().optional(),
        description: z.string().nullable().optional(),
        lessonDate: z.coerce.date().optional(),
        status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(await prisma.lesson.update({ where: { id: req.params.id }, data: req.body })),
  ),
);

lessonsRouter.delete(
  "/lessons/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.lesson.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

lessonsRouter.post(
  "/lessons/:id/homework",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        maxScore: z.number().int().positive().optional(),
        deadline: z.coerce.date(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const lesson = await prisma.lesson.findUnique({
      where: { id: req.params.id },
      include: { Group: { include: { Enrollment: true } }, Homework: true },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    if (lesson.Homework) return res.status(409).json({ error: "Lesson already has homework" });
    const homework = await prisma.homework.create({ data: { id: newId(), lessonId: lesson.id, ...req.body } });
    await prisma.notification.createMany({
      data: lesson.Group.Enrollment.map((e) => ({
        id: newId(),
        userId: e.studentId,
        type: "HOMEWORK",
        title: "New homework",
        message: homework.title,
      })),
    });
    res.status(201).json(homework);
  }),
);

lessonsRouter.post(
  "/lessons/:id/attendance",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        records: z.array(
          z.object({ userId: z.string(), status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]) }),
        ),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    await prisma.$transaction(
      req.body.records.map((record: any) =>
        prisma.attendanceRecord.upsert({
          where: { lessonId_studentId: { lessonId: req.params.id, studentId: record.userId } },
          update: { status: record.status, markedAt: new Date() },
          create: { id: newId(), lessonId: req.params.id, studentId: record.userId, status: record.status },
        }),
      ),
    );
    res.json({ message: "Attendance updated" });
  }),
);
