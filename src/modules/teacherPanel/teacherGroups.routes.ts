import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { publicUser } from "../../utils/serializers.js";
import { newId } from "../../utils/ids.js";
import { groupScope, teacherGroup, teacherId } from "../../utils/teacherScope.js";

export const teacherGroupsRouter = Router();

const groupCreate = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    directionId: z.string().min(1),
    status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

const groupUpdate = z.object({
  body: z
    .object({
      name: z.string().min(2).max(120).optional(),
      directionId: z.string().min(1).optional(),
      status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, "At least one group field is required"),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});

const studentMembership = z.object({
  body: z.object({ studentId: z.string().min(1) }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});

teacherGroupsRouter.get(
  "/teacher/groups",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.group.findMany({
        where: await groupScope(req),
        include: {
          Direction: true,
          Teacher: true,
          Enrollment: { include: { User: { select: publicUser } } },
          Lesson: { orderBy: { lessonDate: "desc" }, take: 10 },
        },
      }),
    ),
  ),
);

teacherGroupsRouter.get(
  "/teacher/groups/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, ...(await groupScope(req)) },
      include: {
        Direction: true,
        Teacher: true,
        Enrollment: { include: { User: { select: publicUser } } },
        Lesson: { orderBy: { lessonDate: "desc" }, include: { Homework: true } },
      },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json(group);
  }),
);

teacherGroupsRouter.post(
  "/teacher/groups",
  requireAuth,
  requireRole("TEACHER"),
  validate(groupCreate),
  asyncRoute(async (req: any, res: any) => {
    const direction = await prisma.direction.findUnique({ where: { id: req.body.directionId } });
    if (!direction) return res.status(404).json({ error: "Direction not found" });
    const group = await prisma.group.create({
      data: {
        id: newId(),
        name: req.body.name,
        directionId: req.body.directionId,
        teacherId: await teacherId(req),
        status: req.body.status ?? "ACTIVE",
      },
      include: { Direction: true, Teacher: true },
    });
    res.status(201).json(group);
  }),
);

teacherGroupsRouter.patch(
  "/teacher/groups/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(groupUpdate),
  asyncRoute(async (req: any, res: any) => {
    const group = await teacherGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (req.body.directionId && !(await prisma.direction.findUnique({ where: { id: req.body.directionId } })))
      return res.status(404).json({ error: "Direction not found" });
    res.json(
      await prisma.group.update({ where: { id: group.id }, data: req.body, include: { Direction: true, Teacher: true } }),
    );
  }),
);

teacherGroupsRouter.delete(
  "/teacher/groups/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const group = await teacherGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    await prisma.group.delete({ where: { id: group.id } });
    res.status(204).send();
  }),
);

teacherGroupsRouter.post(
  "/teacher/groups/:id/students",
  requireAuth,
  requireRole("TEACHER"),
  validate(studentMembership),
  asyncRoute(async (req: any, res: any) => {
    const group = await teacherGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const user = await prisma.user.findFirst({ where: { id: req.body.studentId, role: "STUDENT", status: "ACTIVE" } });
    if (!user) return res.status(404).json({ error: "Active student not found" });
    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_groupId: { studentId: user.id, groupId: group.id } },
      update: { status: "ACTIVE" },
      create: { id: newId(), studentId: user.id, groupId: group.id, status: "ACTIVE" },
      include: { User: { select: publicUser }, Group: true },
    });
    res.status(201).json(enrollment);
  }),
);

teacherGroupsRouter.delete(
  "/teacher/groups/:id/students/:studentId",
  requireAuth,
  requireRole("TEACHER"),
  validate(
    z.object({
      body: z.record(z.string(), z.unknown()),
      params: z.object({ id: z.string().min(1), studentId: z.string().min(1) }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const group = await teacherGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_groupId: { studentId: req.params.studentId, groupId: group.id } },
    });
    if (!enrollment) return res.status(404).json({ error: "Student is not in this group" });
    await prisma.enrollment.delete({ where: { id: enrollment.id } });
    res.status(204).send();
  }),
);
