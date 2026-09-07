import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth } from "../../middleware/index.js";
import { userSummary } from "../../utils/serializers.js";
import { uid } from "../../utils/teacherScope.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/dashboard",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const userId = uid(req);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (current.role === "STUDENT") {
      const upcoming = await prisma.lesson.findMany({
        where: {
          Group: { Enrollment: { some: { studentId: userId } } },
          lessonDate: { gte: new Date() },
          status: "PLANNED",
        },
        orderBy: { lessonDate: "asc" },
        take: 5,
        include: { Group: true },
      });
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: userId },
        include: { Group: { include: { Direction: true, Teacher: true, Lesson: true } } },
      });
      const coins = await prisma.coinTransaction.findMany({
        where: { studentId: userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return res.json({
        user: userSummary(current),
        groups: enrollments.map(({ Group: group }) => {
          const completed = group.Lesson.filter((lesson) => lesson.status === "COMPLETED").length;
          return {
            id: group.id,
            name: group.name,
            groupName: group.name,
            courseName: group.courseName,
            directionName: group.Direction.name,
            directionColor: group.Direction.color,
            totalLessons: group.Lesson.length,
            completedLessons: completed,
            progress: group.Lesson.length ? Math.round((completed / group.Lesson.length) * 100) : 0,
            nextLessonDate: group.Lesson.filter((lesson) => lesson.lessonDate >= new Date()).sort(
              (a, b) => a.lessonDate.getTime() - b.lessonDate.getTime(),
            )[0]?.lessonDate,
            teacherName: group.Teacher.fullName,
          };
        }),
        coinBalance: current.coinBalance,
        recentTransactions: coins,
        unreadNotifications: await prisma.notification.count({ where: { userId, isRead: false } }),
        upcomingLessons: upcoming.map((lesson) => ({
          id: lesson.id,
          topic: lesson.topic,
          lessonDate: lesson.lessonDate,
          time: lesson.lessonDate.toISOString().slice(11, 16),
          groupName: lesson.Group.name,
        })),
      });
    }

    // TEACHER acts as a full admin here — there's no separate admin-only
    // data set, so both roles see every group/lesson/submission.
    const owned = await prisma.group.findMany({ select: { id: true } });

    res.json({
      user: userSummary(current),
      stats: {
        groupsCount: owned.length,
        studentsCount: await prisma.enrollment.count({ where: { groupId: { in: owned.map((x) => x.id) } } }),
        todayLessonsCount: await prisma.lesson.count({
          where: {
            groupId: { in: owned.map((x) => x.id) },
            lessonDate: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(24, 0, 0, 0)),
            },
          },
        }),
        pendingGradingCount: await prisma.submission.count({ where: { status: "SUBMITTED" } }),
      },
      upcomingLessons: (
        await prisma.lesson.findMany({
          where: { lessonDate: { gte: new Date() }, status: "PLANNED" },
          orderBy: { lessonDate: "asc" },
          take: 5,
          include: { Group: true },
        })
      ).map((lesson) => ({
        id: lesson.id,
        topic: lesson.topic,
        lessonDate: lesson.lessonDate,
        time: lesson.lessonDate.toISOString().slice(11, 16),
        groupName: lesson.Group.name,
      })),
    });
  }),
);
