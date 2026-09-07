import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { lower, publicUser, userSummary } from "../../utils/serializers.js";
import { newId } from "../../utils/ids.js";
import { uid, groupScope } from "../../utils/teacherScope.js";

const staff = ["TEACHER", "ADMIN"];

export const groupsRouter = Router();

groupsRouter.get(
  "/groups",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    const groups = await prisma.group.findMany({
      where: current.role === "STUDENT" ? { Enrollment: { some: { studentId: current.id } } } : {},
      include: { Direction: true, Teacher: true, Enrollment: true },
    });
    res.json({
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        direction: { id: group.Direction.id, name: group.Direction.name, color: group.Direction.color },
        teacher: { id: group.Teacher.id, fullName: group.Teacher.fullName, avatar: group.Teacher.avatar },
        studentCount: group.Enrollment.length,
        status: lower(group.status),
      })),
    });
  }),
);

groupsRouter.get(
  "/groups/:id/attendance/week",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.record(z.string(), z.unknown()).default({}),
      params: z.object({ id: z.string() }),
      query: z.object({ date: z.string().optional() }),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const group = await prisma.group.findFirst({ where: { id: req.params.id, ...(await groupScope(req)) } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    const selected = req.query.date ? new Date(String(req.query.date)) : new Date();
    if (Number.isNaN(selected.getTime())) return res.status(400).json({ error: "Invalid date" });
    const weekStart = new Date(selected);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const lessons = await prisma.lesson.findMany({
      where: { groupId: group.id, lessonDate: { gte: weekStart, lt: weekEnd } },
      include: { AttendanceRecord: true },
      orderBy: { lessonDate: "asc" },
    });
    res.json({
      weekStart,
      weekEnd,
      lessons: lessons.map((lesson) => ({ ...lesson, attendance: lesson.AttendanceRecord })),
    });
  }),
);

groupsRouter.get(
  "/groups/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    const group = await prisma.group.findFirst({
      where: {
        id: req.params.id,
        ...(current.role === "STUDENT" ? { Enrollment: { some: { studentId: current.id } } } : {}),
      },
      include: {
        Direction: true,
        Teacher: true,
        Enrollment: current.role === "STUDENT" ? false : { include: { User: { select: publicUser } } },
        Lesson: {
          orderBy: { lessonDate: "desc" },
          include: {
            Homework: true,
            AttendanceRecord: current.role === "STUDENT" ? { where: { studentId: current.id } } : true,
          },
        },
      },
    });
    if (!group)
      return res.status(current.role === "STUDENT" ? 403 : 404).json({
        error: current.role === "STUDENT" ? "You are not enrolled in this group" : "Group not found",
      });
    const response: any = {
      group: {
        id: group.id,
        name: group.name,
        courseName: group.courseName,
        directionName: group.Direction.name,
        teacherName: group.Teacher.fullName,
        studentCount: group.Enrollment?.length ?? 0,
        maxStudents: group.maxStudents,
        schedule: {
          days: group.scheduleDays ? group.scheduleDays.split(",").filter(Boolean) : [],
          time: group.scheduleTime,
        },
      },
      lessons: group.Lesson.map((lesson) => ({
        id: lesson.id,
        topic: lesson.topic,
        lessonOrder: lesson.lessonOrder,
        lessonDate: lesson.lessonDate,
        homework: lesson.Homework
          ? {
              id: lesson.Homework.id,
              title: lesson.Homework.title,
              deadline: lesson.Homework.deadline,
              isOverdue: lesson.Homework.deadline < new Date(),
              ...(current.role === "STUDENT"
                ? { status: "not_submitted", score: null, maxScore: lesson.Homework.maxScore }
                : { submittedCount: 0, gradedCount: 0 }),
            }
          : undefined,
      })),
    };
    if (current.role !== "STUDENT")
      response.students = (group.Enrollment ?? []).map((enrollment: any) => userSummary(enrollment.User));
    res.json(response);
  }),
);

groupsRouter.post(
  "/groups",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        name: z.string().min(2),
        courseName: z.string().optional(),
        directionId: z.string(),
        teacherId: z.string(),
        maxStudents: z.number().int().positive().optional(),
        scheduleDays: z.string(),
        scheduleTime: z.string(),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const group = await prisma.group.create({
      data: { id: newId(), ...req.body },
      include: { Direction: true, Teacher: true, Enrollment: true },
    });
    res.status(201).json(group);
  }),
);

groupsRouter.patch(
  "/groups/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        name: z.string().min(2).optional(),
        courseName: z.string().optional(),
        directionId: z.string().optional(),
        teacherId: z.string().optional(),
        maxStudents: z.number().int().positive().optional(),
        scheduleDays: z.string().optional(),
        scheduleTime: z.string().optional(),
        status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json(await prisma.group.update({ where: { id: group.id }, data: req.body }));
  }),
);

groupsRouter.delete(
  "/groups/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (!(await prisma.group.findUnique({ where: { id: req.params.id } })))
      return res.status(404).json({ error: "Group not found" });
    await prisma.group.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

groupsRouter.post(
  "/groups/:id/students",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({ userId: z.string() }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const student = await prisma.user.findFirst({ where: { id: req.body.userId, role: "STUDENT" } });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.status(201).json(
      await prisma.enrollment.upsert({
        where: { studentId_groupId: { studentId: student.id, groupId: group.id } },
        update: {},
        create: { id: newId(), studentId: student.id, groupId: group.id },
      }),
    );
  }),
);

groupsRouter.delete(
  "/groups/:id/students/:userId",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.record(z.string(), z.unknown()).default({}),
      params: z.object({ id: z.string(), userId: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    await prisma.enrollment.deleteMany({ where: { groupId: req.params.id, studentId: req.params.userId } });
    res.status(204).send();
  }),
);

groupsRouter.post(
  "/groups/:id/lessons",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        topic: z.string().min(1),
        description: z.string().optional(),
        lessonDate: z.coerce.date(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    if (!(await prisma.group.findUnique({ where: { id: req.params.id } })))
      return res.status(404).json({ error: "Group not found" });
    const last = await prisma.lesson.findFirst({
      where: { groupId: req.params.id },
      orderBy: { lessonOrder: "desc" },
    });
    res.status(201).json(
      await prisma.lesson.create({
        data: { id: newId(), groupId: req.params.id, lessonOrder: (last?.lessonOrder ?? 0) + 1, ...req.body },
      }),
    );
  }),
);
