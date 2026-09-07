import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, requireRole } from "../../middleware/index.js";
import { publicUser, userSummary } from "../../utils/serializers.js";
import { groupScope } from "../../utils/teacherScope.js";

export const teacherDashboardRouter = Router();

// Teacher panel: every query is scoped to the authenticated teacher's groups.
teacherDashboardRouter.get(
  "/teacher/dashboard",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncRoute(async (req: any, res: any) => {
    const groups = await prisma.group.findMany({
      where: await groupScope(req),
      include: {
        Direction: true,
        Teacher: true,
        Enrollment: true,
        Lesson: { orderBy: { lessonDate: "desc" }, take: 5 },
      },
    });
    const groupIds = groups.map((group) => group.id);
    const [submissions, students, lessons] = await Promise.all([
      prisma.submission.count({ where: { Homework: { Lesson: { groupId: { in: groupIds } } }, status: "SUBMITTED" } }),
      prisma.enrollment.count({ where: { groupId: { in: groupIds }, status: "ACTIVE" } }),
      prisma.lesson.count({ where: { groupId: { in: groupIds } } }),
    ]);
    res.json({
      groups,
      stats: { groups: groups.length, students, lessons, pendingSubmissions: submissions },
    });
  }),
);

teacherDashboardRouter.get(
  "/teacher/students",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncRoute(async (req: any, res: any) => {
    const groups = await prisma.group.findMany({ where: await groupScope(req), select: { id: true } });
    const rows = await prisma.enrollment.findMany({
      where: { groupId: { in: groups.map((group) => group.id) }, status: { not: "DROPPED" } },
      include: { User: { select: publicUser }, Group: true },
      orderBy: { joinedAt: "desc" },
    });
    const students = new Map<string, any>();
    for (const row of rows) {
      const student = students.get(row.studentId) ?? { ...userSummary(row.User), groups: [] };
      student.groups.push({ id: row.Group.id, name: row.Group.name });
      students.set(row.studentId, student);
    }
    res.json({ students: [...students.values()] });
  }),
);
