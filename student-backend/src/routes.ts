import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma.js";
import {
  asyncRoute,
  errorHandler,
  requireAuth,
  requireRole,
  validate,
} from "./middleware.js";
import {
  authenticate,
  register,
  issueAccessToken,
  issueRefreshToken,
} from "./auth.js";

const router = Router();
const auth = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    phone: z.string().optional(),
    role: z.enum(["student", "teacher"]).optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});
const staff = ["TEACHER", "ADMIN"];
const idSchema = z.object({
  body: z.record(z.string(), z.unknown()).default({}),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});
const publicUser = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatar: true,
  role: true,
  status: true,
} as const;
const uid = (req: any) => req.user.id;
const newId = () => crypto.randomUUID();
const lower = (value: string | null | undefined) => value?.toLowerCase();
const userSummary = (user: any) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  avatar: user.avatar ?? null,
  phone: user.phone ?? null,
  role: lower(user.role),
  status: lower(user.status),
  coinBalance: user.coinBalance ?? 0,
});
const paymentSummary = (payment: any, includeStudent = false) => ({
  id: payment.id,
  orderNumber: payment.orderNumber,
  amountNumber: payment.amountNumber || payment.amount,
  status: lower(payment.status),
  paymentType: lower(payment.paymentType),
  paidAt: payment.paidAt,
  teacherName: payment.teacherName,
  description: payment.description,
  receiptNumber: payment.receiptNumber,
  ...(includeStudent
    ? {
        userId: payment.User?.id ?? payment.studentId,
        studentName: payment.User
          ? `${payment.User.firstName} ${payment.User.lastName}`
          : undefined,
      }
    : {}),
});
const avatarSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .max(2_000_000)
    .nullable()
    .refine(
      (value) =>
        value === null ||
        /^https?:\/\/|^data:image\/[a-z0-9.+-]+;base64,/.test(value),
      "Avatar must be an http(s) URL or supported image data URL",
    ),
);
const profileSchema = z.object({
  body: z
    .object({
      firstName: z.string().min(2).max(80).optional(),
      lastName: z.string().min(2).max(80).optional(),
      phone: z.string().max(30).nullable().optional(),
      avatar: avatarSchema.optional(),
    })
    .refine(
      (body) => Object.keys(body).length > 0,
      "At least one profile field is required",
    ),
  params: z.object({}),
  query: z.object({}),
});
const gradeBody = z.object({
  score: z.coerce.number().int().min(0),
  feedback: z.string().max(5000).optional(),
});
const emailSchema = z.object({
  body: z.object({ email: z.string().email() }),
  params: z.object({}),
  query: z.object({}),
});
const passwordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(128),
  }),
  params: z.object({}),
  query: z.object({}),
});
const teacherId = async (req: any) => {
  const teacher = await prisma.teacher.findUnique({
    where: { userId: uid(req) },
  });
  if (!teacher) {
    const error: any = new Error("Teacher profile not found");
    error.status = 403;
    throw error;
  }
  return teacher.id;
};
const groupScope = async (req: any) =>
  req.user.role === "ADMIN" ? {} : { teacherId: await teacherId(req) };
const teacherGroup = async (req: any, groupId: string) =>
  prisma.group.findFirst({
    where: { id: groupId, ...(await groupScope(req)) },
  });
router.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "asmo-student-backend" }),
);
router.post(
  "/auth/register",
  validate(auth),
  asyncRoute(async (req: any, res: any) =>
    res
      .status(201)
      .json(
        await register({
          ...req.body,
          firstName: req.body.firstName ?? "Student",
          lastName: req.body.lastName ?? "User",
        }),
      ),
  ),
);
router.post(
  "/auth/login",
  validate(auth),
  asyncRoute(async (req: any, res: any) => {
    const result = await authenticate(req.body.email, req.body.password);
    if (!result)
      return res.status(401).json({ error: "Email or password is incorrect" });
    res.json(result);
  }),
);
router.post(
  "/auth/refresh",
  asyncRoute(async (req: any, res: any) => {
    try {
      const hash = crypto
        .createHash("sha256")
        .update(req.body.refreshToken ?? "")
        .digest("hex");
      const token = await prisma.refreshToken.findUnique({
        where: { tokenHash: hash },
        include: { User: true },
      });
      if (!token || token.revokedAt || token.expiresAt < new Date())
        return res.status(401).json({ error: "Invalid refresh token" });
      await prisma.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      res.json({
        user: await prisma.user.findUniqueOrThrow({
          where: { id: token.userId },
          select: publicUser,
        }),
        accessToken: issueAccessToken(token.User),
        refreshToken: await issueRefreshToken(token.userId),
      });
    } catch {
      res.status(401).json({ error: "Invalid refresh token" });
    }
  }),
);
router.get(
  "/auth/me",
  requireAuth,
  asyncRoute(async (req: any, res: any) =>
    res.json(
      userSummary(
        await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } }),
      ),
    ),
  ),
);
router.patch(
  "/profile",
  requireAuth,
  validate(profileSchema),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({
      where: { id: uid(req) },
      data: req.body,
      select: publicUser,
    });
    res.json(user);
  }),
);
router.patch(
  "/settings/email",
  requireAuth,
  validate(emailSchema),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({
      where: { id: uid(req) },
      data: { email: req.body.email },
      select: publicUser,
    });
    await prisma.refreshToken.updateMany({
      where: { userId: uid(req) },
      data: { revokedAt: new Date() },
    });
    res.json({ user, message: "Email updated. Please log in again." });
  }),
);
router.patch(
  "/settings/password",
  requireAuth,
  validate(passwordSchema),
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    if (!(await bcrypt.compare(req.body.currentPassword, current.passwordHash)))
      return res.status(400).json({ error: "Current password is incorrect" });
    await prisma.user.update({
      where: { id: current.id },
      data: { passwordHash: await bcrypt.hash(req.body.newPassword, 12) },
    });
    await prisma.refreshToken.updateMany({
      where: { userId: current.id },
      data: { revokedAt: new Date() },
    });
    res.json({
      success: true,
      message: "Password updated. Please log in again.",
    });
  }),
);
router.get(
  "/dashboard",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const userId = uid(req);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
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
    if (current.role === "STUDENT") {
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: userId },
        include: {
          Group: { include: { Direction: true, Teacher: true, Lesson: true } },
        },
      });
      const coins = await prisma.coinTransaction.findMany({
        where: { studentId: userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return res.json({
        user: userSummary(current),
        groups: enrollments.map(({ Group: group }) => {
          const completed = group.Lesson.filter(
            (lesson) => lesson.status === "COMPLETED",
          ).length;
          return {
            id: group.id,
            name: group.name,
            groupName: group.name,
            courseName: group.courseName,
            directionName: group.Direction.name,
            directionColor: group.Direction.color,
            totalLessons: group.Lesson.length,
            completedLessons: completed,
            progress: group.Lesson.length
              ? Math.round((completed / group.Lesson.length) * 100)
              : 0,
            nextLessonDate: group.Lesson.filter(
              (lesson) => lesson.lessonDate >= new Date(),
            ).sort((a, b) => a.lessonDate.getTime() - b.lessonDate.getTime())[0]
              ?.lessonDate,
            teacherName: group.Teacher.fullName,
          };
        }),
        coinBalance: current.coinBalance,
        recentTransactions: coins,
        unreadNotifications: await prisma.notification.count({
          where: { userId, isRead: false },
        }),
        upcomingLessons: upcoming.map((lesson) => ({
          id: lesson.id,
          topic: lesson.topic,
          lessonDate: lesson.lessonDate,
          time: lesson.lessonDate.toISOString().slice(11, 16),
          groupName: lesson.Group.name,
        })),
      });
    }
    const teacher =
      current.role === "ADMIN"
        ? null
        : await prisma.teacher.findUnique({ where: { userId } });
    const owned =
      current.role === "ADMIN"
        ? await prisma.group.findMany({ select: { id: true } })
        : await prisma.group.findMany({
            where: { teacherId: teacher?.id ?? "__none__" },
            select: { id: true },
          });
    res.json({
      user: userSummary(current),
      stats: {
        groupsCount: owned.length,
        studentsCount: await prisma.enrollment.count({
          where: { groupId: { in: owned.map((x) => x.id) } },
        }),
        todayLessonsCount: await prisma.lesson.count({
          where: {
            groupId: { in: owned.map((x) => x.id) },
            lessonDate: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(24, 0, 0, 0)),
            },
          },
        }),
        pendingGradingCount: await prisma.submission.count({
          where: { status: "SUBMITTED" },
        }),
      },
      upcomingLessons: (current.role === "ADMIN"
        ? await prisma.lesson.findMany({
            where: { lessonDate: { gte: new Date() }, status: "PLANNED" },
            orderBy: { lessonDate: "asc" },
            take: 5,
            include: { Group: true },
          })
        : upcoming
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
router.get(
  "/groups",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    const groups = await prisma.group.findMany({
      where:
        current.role === "STUDENT"
          ? { Enrollment: { some: { studentId: current.id } } }
          : {},
      include: { Direction: true, Teacher: true, Enrollment: true },
    });
    res.json({
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        direction: {
          id: group.Direction.id,
          name: group.Direction.name,
          color: group.Direction.color,
        },
        teacher: {
          id: group.Teacher.id,
          fullName: group.Teacher.fullName,
          avatar: group.Teacher.avatar,
        },
        studentCount: group.Enrollment.length,
        status: lower(group.status),
      })),
    });
  }),
);
router.get(
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
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, ...(await groupScope(req)) },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });
    const selected = req.query.date
      ? new Date(String(req.query.date))
      : new Date();
    if (Number.isNaN(selected.getTime()))
      return res.status(400).json({ error: "Invalid date" });
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
      lessons: lessons.map((lesson) => ({
        ...lesson,
        attendance: lesson.AttendanceRecord,
      })),
    });
  }),
);
router.get(
  "/groups/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    const group = await prisma.group.findFirst({
      where: {
        id: req.params.id,
        ...(current.role === "STUDENT"
          ? { Enrollment: { some: { studentId: current.id } } }
          : {}),
      },
      include: {
        Direction: true,
        Teacher: true,
        Enrollment:
          current.role === "STUDENT"
            ? false
            : { include: { User: { select: publicUser } } },
        Lesson: {
          orderBy: { lessonDate: "desc" },
          include: {
            Homework: true,
            AttendanceRecord:
              current.role === "STUDENT"
                ? { where: { studentId: current.id } }
                : true,
          },
        },
      },
    });
    if (!group)
      return res
        .status(current.role === "STUDENT" ? 403 : 404)
        .json({
          error:
            current.role === "STUDENT"
              ? "You are not enrolled in this group"
              : "Group not found",
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
          days: group.scheduleDays
            ? group.scheduleDays.split(",").filter(Boolean)
            : [],
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
                ? {
                    status: "not_submitted",
                    score: null,
                    maxScore: lesson.Homework.maxScore,
                  }
                : { submittedCount: 0, gradedCount: 0 }),
            }
          : undefined,
      })),
    };
    if (current.role !== "STUDENT")
      response.students = (group.Enrollment ?? []).map((enrollment: any) =>
        userSummary(enrollment.User),
      );
    res.json(response);
  }),
);
router.get(
  "/lessons/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: req.params.id,
        ...(current.role === "STUDENT"
          ? { Group: { Enrollment: { some: { studentId: current.id } } } }
          : {}),
      },
      include: {
        Group: true,
        Homework: {
          include: { Submission: { where: { studentId: current.id } } },
        },
        AttendanceRecord: true,
      },
    });
    if (!lesson)
      return res
        .status(current.role === "STUDENT" ? 403 : 404)
        .json({ error: "Lesson not found or access denied" });
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
        ? {
            submission: submission
              ? { ...submission, status: lower(submission.status) }
              : null,
          }
        : { roster: lesson.AttendanceRecord }),
    });
  }),
);
router.post(
  "/homework/:id/submit",
  requireAuth,
  validate(
    idSchema.extend({
      body: z.object({ content: z.string().min(1).max(10000) }),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const homework = await prisma.homework.findFirst({
      where: {
        id: req.params.id,
        Lesson: { Group: { Enrollment: { some: { studentId: uid(req) } } } },
      },
    });
    if (!homework) return res.status(404).json({ error: "Homework not found" });
    if (homework.deadline < new Date())
      return res.status(400).json({ error: "Homework deadline has passed" });
    const item = await prisma.submission.upsert({
      where: {
        homeworkId_studentId: { homeworkId: homework.id, studentId: uid(req) },
      },
      update: { content: req.body.content, submittedAt: new Date() },
      create: {
        id: newId(),
        homeworkId: homework.id,
        studentId: uid(req),
        content: req.body.content,
      },
    });
    res.status(201).json(item);
  }),
);
router.get(
  "/attendance",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const records = await prisma.attendanceRecord.findMany({
      where: { studentId: uid(req) },
      orderBy: { Lesson: { lessonDate: "desc" } },
      include: { Lesson: { include: { Group: true } } },
    });
    const present = records.filter((x) => x.status === "PRESENT").length;
    res.json({
      records,
      stats: {
        total: records.length,
        present,
        percentage: records.length
          ? Math.round((present / records.length) * 100)
          : 0,
      },
    });
  }),
);
router.get(
  "/coins",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    if (current.role === "STUDENT") {
      const transactions = await prisma.coinTransaction.findMany({
        where: { studentId: current.id },
        orderBy: { createdAt: "desc" },
      });
      return res.json({
        balance: current.coinBalance,
        transactions: transactions.map(({ id, amount, reason, createdAt }) => ({
          id,
          amount,
          reason,
          createdAt,
        })),
      });
    }
    const transactions = await prisma.coinTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { User: true },
    });
    res.json({
      transactions: transactions.map(
        ({ id, studentId, amount, reason, createdAt, User }) => ({
          id,
          userId: studentId,
          studentName: `${User.firstName} ${User.lastName}`,
          amount,
          reason,
          createdAt,
        }),
      ),
    });
  }),
);
router.get(
  "/leaderboard",
  requireAuth,
  asyncRoute(async (_req: any, res: any) => {
    const users = await prisma.user.findMany({
      where: { role: "STUDENT", status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatar: true,
        CoinTransaction: { select: { amount: true } },
      },
    });
    res.json(
      users
        .map((u) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          avatar: u.avatar,
          balance: u.CoinTransaction.reduce((s, x) => s + x.amount, 0),
        }))
        .sort((a, b) => b.balance - a.balance),
    );
  }),
);
router.get(
  "/notifications",
  requireAuth,
  asyncRoute(async (req: any, res: any) =>
    res.json({
      notifications: (
        await prisma.notification.findMany({
          where: { userId: uid(req) },
          orderBy: { createdAt: "desc" },
        })
      ).map((item) => ({ ...item, type: lower(item.type) })),
    }),
  ),
);
router.patch(
  "/notifications/read-all",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    await prisma.notification.updateMany({
      where: { userId: uid(req), isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true });
  }),
);
router.patch(
  "/notifications/:id/read",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: uid(req) },
      data: { isRead: true },
    });
    if (!result.count)
      return res.status(404).json({ error: "Notification not found" });
    res.json({ success: true });
  }),
);
router.get(
  "/products",
  asyncRoute(async (req: any, res: any) => {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(req.query.category ? { category: String(req.query.category) } : {}),
        ...(req.query.search
          ? { name: { contains: String(req.query.search) } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ products: products.map(({ isActive, ...product }) => product) });
  }),
);
router.get(
  "/payments",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    const payments = await prisma.payment.findMany({
      where: current.role === "STUDENT" ? { studentId: current.id } : {},
      include: { User: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      payments: payments.map((payment) =>
        paymentSummary(payment, current.role !== "STUDENT"),
      ),
    });
  }),
);
router.get(
  "/wishlist",
  requireAuth,
  asyncRoute(async (req: any, res: any) =>
    res.json({
      wishlist: (
        await prisma.wishlistItem.findMany({
          where: { studentId: uid(req) },
          include: { Product: true },
        })
      ).map((item) => item.Product),
    }),
  ),
);
router.post(
  "/wishlist/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) =>
    res
      .status(201)
      .json(
        await prisma.wishlistItem.upsert({
          where: {
            studentId_productId: {
              studentId: uid(req),
              productId: req.params.id,
            },
          },
          update: {},
          create: {
            id: newId(),
            studentId: uid(req),
            productId: req.params.id,
          },
        }),
      ),
  ),
);
router.delete(
  "/wishlist/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.wishlistItem.deleteMany({
      where: { studentId: uid(req), productId: req.params.id },
    });
    res.status(204).send();
  }),
);

// Teacher panel: every query is scoped to the authenticated teacher's groups.
router.get(
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
      prisma.submission.count({
        where: {
          Homework: { Lesson: { groupId: { in: groupIds } } },
          status: "SUBMITTED",
        },
      }),
      prisma.enrollment.count({
        where: { groupId: { in: groupIds }, status: "ACTIVE" },
      }),
      prisma.lesson.count({ where: { groupId: { in: groupIds } } }),
    ]);
    res.json({
      groups,
      stats: {
        groups: groups.length,
        students,
        lessons,
        pendingSubmissions: submissions,
      },
    });
  }),
);
router.get(
  "/teacher/students",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncRoute(async (req: any, res: any) => {
    const groups = await prisma.group.findMany({
      where: await groupScope(req),
      select: { id: true },
    });
    const rows = await prisma.enrollment.findMany({
      where: {
        groupId: { in: groups.map((group) => group.id) },
        status: { not: "DROPPED" },
      },
      include: { User: { select: publicUser }, Group: true },
      orderBy: { joinedAt: "desc" },
    });
    const students = new Map<string, any>();
    for (const row of rows) {
      const student = students.get(row.studentId) ?? {
        ...userSummary(row.User),
        groups: [],
      };
      student.groups.push({ id: row.Group.id, name: row.Group.name });
      students.set(row.studentId, student);
    }
    res.json({ students: [...students.values()] });
  }),
);
router.get(
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
router.get(
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
        Lesson: {
          orderBy: { lessonDate: "desc" },
          include: { Homework: true },
        },
      },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json(group);
  }),
);
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
router.post(
  "/teacher/lessons",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(lessonCreate),
  asyncRoute(async (req: any, res: any) => {
    if (!(await teacherGroup(req, req.body.groupId)))
      return res.status(403).json({ error: "You do not own this group" });
    const lesson = await prisma.lesson.create({
      data: { id: newId(), ...req.body },
    });
    res.status(201).json(lesson);
  }),
);
router.patch(
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
    const lesson = await prisma.lesson.findFirst({
      where: { id: req.params.id, Group: { teacherId: await teacherId(req) } },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    res.json(
      await prisma.lesson.update({ where: { id: lesson.id }, data: req.body }),
    );
  }),
);
router.post(
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
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: req.body.lessonId,
        Group: { teacherId: await teacherId(req) },
      },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    const homework = await prisma.homework.create({
      data: { id: newId(), ...req.body },
    });
    res.status(201).json(homework);
  }),
);
router.get(
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
router.get(
  "/submissions",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.submission.findMany({
        where: {
          Homework: { Lesson: { Group: await groupScope(req) } },
          ...(req.query.status
            ? { status: String(req.query.status).toUpperCase() }
            : {}),
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
router.get(
  "/teacher/submissions/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const submission = await prisma.submission.findFirst({
      where: {
        id: req.params.id,
        Homework: { Lesson: { Group: await groupScope(req) } },
      },
      include: {
        User: { select: publicUser },
        Homework: { include: { Lesson: { include: { Group: true } } } },
      },
    });
    if (!submission)
      return res.status(404).json({ error: "Submission not found" });
    res.json(submission);
  }),
);
router.patch(
  "/teacher/submissions/:id/grade",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(
    z.object({
      body: gradeBody,
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const submission = await prisma.submission.findFirst({
      where: {
        id: req.params.id,
        Homework: { Lesson: { Group: await groupScope(req) } },
      },
    });
    if (!submission)
      return res.status(404).json({ error: "Submission not found" });
    const homework = await prisma.homework.findUniqueOrThrow({
      where: { id: submission.homeworkId },
    });
    if (req.body.score > homework.maxScore)
      return res.status(400).json({ error: "Score cannot exceed maxScore" });
    res.json(
      await prisma.submission.update({
        where: { id: submission.id },
        data: {
          score: req.body.score,
          feedback: req.body.feedback,
          status: "GRADED",
          gradedAt: new Date(),
        },
      }),
    );
  }),
);
const attendanceBody = z.object({
  body: z.object({
    status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
    note: z.string().max(1000).optional(),
  }),
  params: z.object({ lessonId: z.string(), studentId: z.string() }),
  query: z.object({}),
});
router.put(
  "/teacher/attendance/:lessonId/:studentId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(attendanceBody),
  asyncRoute(async (req: any, res: any) => {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: req.params.lessonId,
        Group: {
          teacherId: await teacherId(req),
          Enrollment: { some: { User: { id: req.params.studentId } } },
        },
      },
    });
    if (!lesson)
      return res.status(404).json({ error: "Lesson or student not found" });
    res.json(
      await prisma.attendanceRecord.upsert({
        where: {
          lessonId_studentId: {
            lessonId: lesson.id,
            studentId: req.params.studentId,
          },
        },
        update: req.body,
        create: {
          id: newId(),
          lessonId: lesson.id,
          studentId: req.params.studentId,
          ...req.body,
        },
      }),
    );
  }),
);
router.post(
  "/teacher/coins",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  validate(
    z.object({
      body: z.object({
        studentId: z.string(),
        amount: z.number().int().min(-1000).max(1000),
        reason: z.string().min(1).max(200),
        sourceType: z.enum(["ATTENDANCE", "HOMEWORK", "BONUS", "PENALTY"]),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const groups = await prisma.group.findMany({
      where: { teacherId: await teacherId(req) },
      select: { id: true },
    });
    const enrolled = await prisma.enrollment.findFirst({
      where: {
        studentId: req.body.studentId,
        groupId: { in: groups.map((group) => group.id) },
      },
    });
    if (!enrolled)
      return res.status(403).json({ error: "Student is not in your groups" });
    res
      .status(201)
      .json(
        await prisma.coinTransaction.create({
          data: { id: newId(), ...req.body },
        }),
      );
  }),
);
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
    .refine(
      (body) => Object.keys(body).length > 0,
      "At least one group field is required",
    ),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});
const studentMembership = z.object({
  body: z.object({ studentId: z.string().min(1) }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});
router.post(
  "/teacher/groups",
  requireAuth,
  requireRole("TEACHER"),
  validate(groupCreate),
  asyncRoute(async (req: any, res: any) => {
    const direction = await prisma.direction.findUnique({
      where: { id: req.body.directionId },
    });
    if (!direction)
      return res.status(404).json({ error: "Direction not found" });
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
router.patch(
  "/teacher/groups/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(groupUpdate),
  asyncRoute(async (req: any, res: any) => {
    const group = await teacherGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (
      req.body.directionId &&
      !(await prisma.direction.findUnique({
        where: { id: req.body.directionId },
      }))
    )
      return res.status(404).json({ error: "Direction not found" });
    res.json(
      await prisma.group.update({
        where: { id: group.id },
        data: req.body,
        include: { Direction: true, Teacher: true },
      }),
    );
  }),
);
router.delete(
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
router.post(
  "/teacher/groups/:id/students",
  requireAuth,
  requireRole("TEACHER"),
  validate(studentMembership),
  asyncRoute(async (req: any, res: any) => {
    const group = await teacherGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const user = await prisma.user.findFirst({
      where: { id: req.body.studentId, role: "STUDENT", status: "ACTIVE" },
    });
    if (!user)
      return res.status(404).json({ error: "Active student not found" });
    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_groupId: { studentId: user.id, groupId: group.id } },
      update: { status: "ACTIVE" },
      create: {
        id: newId(),
        studentId: user.id,
        groupId: group.id,
        status: "ACTIVE",
      },
      include: { User: { select: publicUser }, Group: true },
    });
    res.status(201).json(enrollment);
  }),
);
router.delete(
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
      where: {
        studentId_groupId: {
          studentId: req.params.studentId,
          groupId: group.id,
        },
      },
    });
    if (!enrollment)
      return res.status(404).json({ error: "Student is not in this group" });
    await prisma.enrollment.delete({ where: { id: enrollment.id } });
    res.status(204).send();
  }),
);
const paymentData = z.object({
  amount: z.number().int().positive(),
  status: z.enum(["PAID", "PENDING", "OVERDUE", "CANCELLED"]).optional(),
  paymentType: z.enum(["CASH", "CLICK", "PAYME", "BANK", "UZUM"]),
  description: z.string().max(500).nullable().optional(),
  dueDate: z.coerce.date(),
  paidAt: z.coerce.date().nullable().optional(),
});
const paymentCreate = z.object({
  body: paymentData.extend({ studentId: z.string().min(1) }),
  params: z.object({}),
  query: z.object({}),
});
const paymentUpdate = z.object({
  body: paymentData
    .partial()
    .refine(
      (body) => Object.keys(body).length > 0,
      "At least one payment field is required",
    ),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});
const teacherStudentIds = async (req: any) => {
  const groups = await prisma.group.findMany({
    where: await groupScope(req),
    select: { id: true },
  });
  return prisma.enrollment.findMany({
    where: {
      groupId: { in: groups.map((group) => group.id) },
      status: { not: "DROPPED" },
    },
    select: { studentId: true },
  });
};
router.get(
  "/teacher/payments",
  requireAuth,
  requireRole("TEACHER"),
  asyncRoute(async (req: any, res: any) => {
    const memberships = await teacherStudentIds(req);
    const payments = await prisma.payment.findMany({
      where: {
        studentId: { in: memberships.map((item) => item.studentId) },
        ...(req.query.status ? { status: String(req.query.status) } : {}),
      },
      include: { User: { select: publicUser } },
      orderBy: { createdAt: "desc" },
    });
    res.json(payments);
  }),
);
router.post(
  "/teacher/payments",
  requireAuth,
  requireRole("TEACHER"),
  validate(paymentCreate),
  asyncRoute(async (req: any, res: any) => {
    const memberships = await teacherStudentIds(req);
    if (!memberships.some((item) => item.studentId === req.body.studentId))
      return res.status(403).json({ error: "Student is not in your groups" });
    const payment = await prisma.payment.create({
      data: { id: newId(), ...req.body },
      include: { User: { select: publicUser } },
    });
    res.status(201).json(payment);
  }),
);
router.patch(
  "/teacher/payments/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(paymentUpdate),
  asyncRoute(async (req: any, res: any) => {
    const memberships = await teacherStudentIds(req);
    const payment = await prisma.payment.findFirst({
      where: {
        id: req.params.id,
        studentId: { in: memberships.map((item) => item.studentId) },
      },
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(
      await prisma.payment.update({
        where: { id: payment.id },
        data: req.body,
        include: { User: { select: publicUser } },
      }),
    );
  }),
);
router.delete(
  "/teacher/payments/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const memberships = await teacherStudentIds(req);
    const payment = await prisma.payment.findFirst({
      where: {
        id: req.params.id,
        studentId: { in: memberships.map((item) => item.studentId) },
      },
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    await prisma.payment.delete({ where: { id: payment.id } });
    res.status(204).send();
  }),
);
router.get(
  "/directions",
  requireAuth,
  asyncRoute(async (_req: any, res: any) => {
    const rows = await prisma.direction.findMany({
      include: { Group: true },
      orderBy: { name: "asc" },
    });
    res.json({
      directions: rows.map((x) => ({
        id: x.id,
        name: x.name,
        color: x.color,
        groupsCount: x.Group.length,
      })),
    });
  }),
);
router.post(
  "/directions",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({ name: z.string().min(2), color: z.string().optional() }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res
      .status(201)
      .json(
        await prisma.direction.create({
          data: {
            id: newId(),
            name: req.body.name,
            color: req.body.color ?? "#3B82F6",
          },
        }),
      ),
  ),
);
router.patch(
  "/directions/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        name: z.string().min(2).optional(),
        color: z.string().optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.direction.update({
        where: { id: req.params.id },
        data: req.body,
      }),
    ),
  ),
);
router.delete(
  "/directions/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (await prisma.group.count({ where: { directionId: req.params.id } }))
      return res.status(400).json({ error: "Direction still has groups" });
    await prisma.direction.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.get(
  "/teachers",
  requireAuth,
  requireRole(...staff),
  asyncRoute(async (_req: any, res: any) => {
    const rows = await prisma.teacher.findMany({ include: { Group: true } });
    const users = await prisma.user.findMany({
      where: { id: { in: rows.flatMap((x) => (x.userId ? [x.userId] : [])) } },
      select: { id: true, email: true },
    });
    const emails = new Map(users.map((user) => [user.id, user.email]));
    res.json({
      teachers: rows.map((x) => ({
        id: x.id,
        fullName: x.fullName,
        avatar: x.avatar,
        email: x.userId ? emails.get(x.userId) : undefined,
        userId: x.userId,
        groupsCount: x.Group.length,
      })),
    });
  }),
);
router.post(
  "/teachers",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z
        .object({
          fullName: z.string().min(2),
          avatar: z.string().optional(),
          email: z.string().email().optional(),
          password: z.string().min(6).optional(),
        })
        .refine(
          (x) => (!x.email && !x.password) || (x.email && x.password),
          "Email and password are required together",
        ),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    let userId: string | undefined;
    if (req.body.email) {
      const result = await register({
        email: req.body.email,
        password: req.body.password,
        firstName: req.body.fullName.split(" ")[0],
        lastName: req.body.fullName.split(" ").slice(1).join(" ") || "Teacher",
        role: "teacher",
      });
      userId = result.user.id;
    }
    const linked = userId
      ? await prisma.teacher.findUnique({ where: { userId } })
      : null;
    const teacher = linked
      ? await prisma.teacher.update({
          where: { id: linked.id },
          data: { fullName: req.body.fullName, avatar: req.body.avatar },
        })
      : await prisma.teacher.create({
          data: {
            id: newId(),
            fullName: req.body.fullName,
            avatar: req.body.avatar,
          },
        });
    res.status(201).json(teacher);
  }),
);
router.patch(
  "/teachers/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        fullName: z.string().min(2).optional(),
        avatar: z.string().nullable().optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.teacher.update({
        where: { id: req.params.id },
        data: req.body,
      }),
    ),
  ),
);
router.delete(
  "/teachers/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (await prisma.group.count({ where: { teacherId: req.params.id } }))
      return res.status(400).json({ error: "Teacher still has groups" });
    await prisma.teacher.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.post(
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
router.patch(
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
    const group = await prisma.group.findUnique({
      where: { id: req.params.id },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json(
      await prisma.group.update({ where: { id: group.id }, data: req.body }),
    );
  }),
);
router.delete(
  "/groups/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (
      (await prisma.lesson.count({ where: { groupId: req.params.id } })) ||
      (await prisma.enrollment.count({ where: { groupId: req.params.id } }))
    )
      return res
        .status(400)
        .json({ error: "Group still has lessons or enrollments" });
    await prisma.group.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.post(
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
    const student = await prisma.user.findFirst({
      where: { id: req.body.userId, role: "STUDENT" },
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const group = await prisma.group.findUnique({
      where: { id: req.params.id },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res
      .status(201)
      .json(
        await prisma.enrollment.upsert({
          where: {
            studentId_groupId: { studentId: student.id, groupId: group.id },
          },
          update: {},
          create: { id: newId(), studentId: student.id, groupId: group.id },
        }),
      );
  }),
);
router.delete(
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
    await prisma.enrollment.deleteMany({
      where: { groupId: req.params.id, studentId: req.params.userId },
    });
    res.status(204).send();
  }),
);
const studentCreate = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phone: z.string().optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});
router.get(
  "/students",
  requireAuth,
  requireRole(...staff),
  asyncRoute(async (req: any, res: any) => {
    const rows = await prisma.user.findMany({
      where: {
        role: "STUDENT",
        ...(req.query.search
          ? {
              OR: [
                { firstName: { contains: String(req.query.search) } },
                { lastName: { contains: String(req.query.search) } },
                { email: { contains: String(req.query.search) } },
              ],
            }
          : {}),
        ...(req.query.groupId
          ? { Enrollment: { some: { groupId: String(req.query.groupId) } } }
          : {}),
      },
      include: {
        Enrollment: { include: { Group: true } },
        AttendanceRecord: true,
      },
    });
    res.json({
      students: rows.map((u) => ({
        ...userSummary(u),
        groups: u.Enrollment.map((e) => ({
          id: e.Group.id,
          name: e.Group.name,
        })),
        attendancePercentage: u.AttendanceRecord.length
          ? Math.round(
              (u.AttendanceRecord.filter((a) => a.status === "PRESENT").length /
                u.AttendanceRecord.length) *
                100,
            )
          : 0,
      })),
    });
  }),
);
router.post(
  "/students",
  requireAuth,
  requireRole(...staff),
  validate(studentCreate),
  asyncRoute(async (req: any, res: any) => {
    const result = await register({ ...req.body, role: "student" });
    res.status(201).json(result.user);
  }),
);
router.get(
  "/students/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, role: "STUDENT" },
      include: {
        Enrollment: { include: { Group: true } },
        AttendanceRecord: { include: { Lesson: true } },
        CoinTransaction: true,
        Payment: true,
        Submission: { include: { Homework: { include: { Lesson: true } } } },
      },
    });
    if (!user) return res.status(404).json({ error: "Student not found" });
    const present = user.AttendanceRecord.filter(
      (a) => a.status === "PRESENT",
    ).length;
    res.json({
      student: userSummary(user),
      groups: user.Enrollment.map((e) => ({
        id: e.Group.id,
        name: e.Group.name,
      })),
      attendance: {
        stats: {
          total: user.AttendanceRecord.length,
          present,
          percentage: user.AttendanceRecord.length
            ? Math.round((present / user.AttendanceRecord.length) * 100)
            : 0,
        },
        records: user.AttendanceRecord,
      },
      coinTransactions: user.CoinTransaction,
      payments: user.Payment.map((p) => paymentSummary(p)),
      submissions: user.Submission.map((s) => ({
        id: s.id,
        homeworkTitle: s.Homework.title,
        lessonTopic: s.Homework.Lesson.topic,
        score: s.score,
        maxScore: s.Homework.maxScore,
        status: lower(s.status),
        submittedAt: s.submittedAt,
      })),
    });
  }),
);
router.patch(
  "/students/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        firstName: z.string().min(2).optional(),
        lastName: z.string().min(2).optional(),
        phone: z.string().nullable().optional(),
        avatar: avatarSchema.optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.updateMany({
      where: { id: req.params.id, role: "STUDENT" },
      data: req.body,
    });
    if (!user.count)
      return res.status(404).json({ error: "Student not found" });
    res.json(
      userSummary(
        await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } }),
      ),
    );
  }),
);
router.post(
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
    res
      .status(201)
      .json(
        await prisma.lesson.create({
          data: {
            id: newId(),
            groupId: req.params.id,
            lessonOrder: (last?.lessonOrder ?? 0) + 1,
            ...req.body,
          },
        }),
      );
  }),
);
router.patch(
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
    res.json(
      await prisma.lesson.update({
        where: { id: req.params.id },
        data: req.body,
      }),
    ),
  ),
);
router.delete(
  "/lessons/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.lesson.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.post(
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
    if (lesson.Homework)
      return res.status(409).json({ error: "Lesson already has homework" });
    const homework = await prisma.homework.create({
      data: { id: newId(), lessonId: lesson.id, ...req.body },
    });
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
router.patch(
  "/homework/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        maxScore: z.number().int().positive().optional(),
        deadline: z.coerce.date().optional(),
        status: z.enum(["ACTIVE", "CLOSED"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.homework.update({
        where: { id: req.params.id },
        data: req.body,
      }),
    ),
  ),
);
router.delete(
  "/homework/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.homework.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.patch(
  "/submissions/:id/grade",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: gradeBody,
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const sub = await prisma.submission.findUnique({
      where: { id: req.params.id },
      include: { Homework: true },
    });
    if (!sub) return res.status(404).json({ error: "Submission not found" });
    if (req.body.score > sub.Homework.maxScore)
      return res.status(400).json({ error: "Score cannot exceed maxScore" });
    const updated = await prisma.submission.update({
      where: { id: sub.id },
      data: {
        score: req.body.score,
        feedback: req.body.feedback,
        status: "GRADED",
        gradedAt: new Date(),
      },
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
router.post(
  "/lessons/:id/attendance",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        records: z.array(
          z.object({
            userId: z.string(),
            status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
          }),
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
          where: {
            lessonId_studentId: {
              lessonId: req.params.id,
              studentId: record.userId,
            },
          },
          update: { status: record.status, markedAt: new Date() },
          create: {
            id: newId(),
            lessonId: req.params.id,
            studentId: record.userId,
            status: record.status,
          },
        }),
      ),
    );
    res.json({ message: "Attendance updated" });
  }),
);
router.post(
  "/students/:id/coins",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({
        amount: z
          .number()
          .int()
          .refine((x) => x !== 0),
        reason: z.string().min(1),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const student = await prisma.user.findFirst({
      where: { id: req.params.id, role: "STUDENT" },
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const result = await prisma.$transaction(async (tx) => {
      const balance = Math.max(0, student.coinBalance + req.body.amount);
      await tx.coinTransaction.create({
        data: {
          id: newId(),
          studentId: student.id,
          amount: req.body.amount,
          reason: req.body.reason,
          sourceType: req.body.amount > 0 ? "BONUS" : "PENALTY",
        },
      });
      await tx.user.update({
        where: { id: student.id },
        data: { coinBalance: balance },
      });
      await tx.notification.create({
        data: {
          id: newId(),
          userId: student.id,
          type: "SYSTEM",
          title: "Coin balance updated",
          message: req.body.reason,
        },
      });
      return balance;
    });
    res.status(201).json({ balance: result });
  }),
);
const payCreate = z.object({
  body: z.object({
    amountNumber: z.number().int().positive(),
    paymentType: z.enum(["CASH", "CLICK", "PAYME", "BANK", "UZUM"]),
    status: z.enum(["PAID", "PENDING", "OVERDUE", "CANCELLED"]).optional(),
    description: z.string().optional(),
    receiptNumber: z.string().optional(),
  }),
  params: z.object({ id: z.string() }),
  query: z.object({}),
});
router.post(
  "/students/:id/payments",
  requireAuth,
  requireRole(...staff),
  validate(payCreate),
  asyncRoute(async (req: any, res: any) => {
    const student = await prisma.user.findFirst({
      where: { id: req.params.id, role: "STUDENT" },
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const teacher = await prisma.teacher.findUnique({
      where: { userId: uid(req) },
    });
    const status = req.body.status ?? "PENDING";
    const payment = await prisma.payment.create({
      data: {
        id: newId(),
        studentId: student.id,
        amount: req.body.amountNumber,
        amountNumber: req.body.amountNumber,
        orderNumber:
          (await prisma.payment.count({ where: { studentId: student.id } })) +
          1,
        status,
        paymentType: req.body.paymentType,
        description: req.body.description,
        receiptNumber: req.body.receiptNumber,
        dueDate: new Date(),
        teacherName:
          teacher?.fullName ??
          `${(await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } })).firstName} ${(await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } })).lastName}`,
        paidAt: status === "PAID" ? new Date() : null,
      },
    });
    res.status(201).json(paymentSummary(payment));
  }),
);
const payUpdate = z.object({
  body: z.object({
    amountNumber: z.number().int().positive().optional(),
    status: z.enum(["PAID", "PENDING", "OVERDUE", "CANCELLED"]).optional(),
    paymentType: z.enum(["CASH", "CLICK", "PAYME", "BANK", "UZUM"]).optional(),
    description: z.string().nullable().optional(),
    receiptNumber: z.string().nullable().optional(),
  }),
  params: z.object({ id: z.string() }),
  query: z.object({}),
});
router.patch(
  "/payments/:id",
  requireAuth,
  requireRole(...staff),
  validate(payUpdate),
  asyncRoute(async (req: any, res: any) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    const nextStatus = req.body.status ?? payment.status;
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        ...req.body,
        ...(req.body.amountNumber ? { amount: req.body.amountNumber } : {}),
        paidAt: nextStatus === "PAID" ? (payment.paidAt ?? new Date()) : null,
      },
    });
    res.json(paymentSummary(updated));
  }),
);
router.delete(
  "/payments/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.payment.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
const productData = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().int().positive(),
  originalPrice: z.number().int().positive().optional(),
  category: z.string().min(1),
  image: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviews: z.number().int().min(0).optional(),
  isPopular: z.boolean().optional(),
  isNew: z.boolean().optional(),
  isLimited: z.boolean().optional(),
});
router.post(
  "/products",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({ body: productData, params: z.object({}), query: z.object({}) }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res
      .status(201)
      .json(
        await prisma.product.create({ data: { id: newId(), ...req.body } }),
      ),
  ),
);
router.patch(
  "/products/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: productData.partial(),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(
      await prisma.product.update({
        where: { id: req.params.id },
        data: req.body,
      }),
    ),
  ),
);
router.delete(
  "/products/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (await prisma.purchase.count({ where: { productId: req.params.id } }))
      return res.status(400).json({ error: "Product has purchase history" });
    await prisma.wishlistItem.deleteMany({
      where: { productId: req.params.id },
    });
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.post(
  "/shop/checkout",
  requireAuth,
  validate(
    z.object({
      body: z.object({
        productIds: z.array(z.string()).min(1).or(z.undefined()),
        items: z
          .array(
            z.object({
              productId: z.string(),
              quantity: z.number().int().positive(),
            }),
          )
          .optional(),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const ids = req.body.items
      ? req.body.items.flatMap((x: any) => Array(x.quantity).fill(x.productId))
      : req.body.productIds;
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
    });
    if (products.length !== ids.length)
      return res.status(400).json({ error: "Product not found" });
    const total = products.reduce((sum, product) => sum + product.price, 0);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: uid(req) } });
      if (user.coinBalance < total)
        throw Object.assign(new Error("Insufficient coin balance"), {
          status: 400,
        });
      const purchases = await Promise.all(
        products.map((product) =>
          tx.purchase.create({
            data: {
              id: newId(),
              studentId: user.id,
              productId: product.id,
              price: product.price,
            },
          }),
        ),
      );
      await tx.coinTransaction.create({
        data: {
          id: newId(),
          studentId: user.id,
          amount: -total,
          reason: "Do'kondan xarid",
          sourceType: "SHOP",
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { coinBalance: { decrement: total } },
      });
      return { purchases, balance: user.coinBalance - total };
    });
    res
      .status(201)
      .json({
        message: "Purchase successful",
        purchaseIds: result.purchases.map((x) => x.id),
        balance: result.balance,
      });
  }),
);
router.get(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  asyncRoute(async (_req: any, res: any) =>
    res.json({
      users: (
        await prisma.user.findMany({
          select: publicUser,
          orderBy: { createdAt: "desc" },
        })
      ).map(userSummary),
    }),
  ),
);
router.post(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  validate(studentCreate),
  asyncRoute(async (req: any, res: any) => {
    const result = await register({ ...req.body, role: "student" });
    res.status(201).json(result.user);
  }),
);
router.patch(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  validate(
    z.object({
      body: z.object({
        firstName: z.string().min(2).optional(),
        lastName: z.string().min(2).optional(),
        phone: z.string().nullable().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(userSummary(user));
  }),
);
router.delete(
  "/admin/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    if (req.params.id === uid(req))
      return res.status(400).json({ error: "You cannot delete yourself" });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
router.patch(
  "/admin/users/:id/role",
  requireAuth,
  requireRole("ADMIN"),
  validate(
    z.object({
      body: z.object({ role: z.enum(["STUDENT", "TEACHER", "ADMIN"]) }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: req.body.role },
    });
    res.json(userSummary(user));
  }),
);
router.patch(
  "/admin/groups/:id/teacher",
  requireAuth,
  requireRole("ADMIN"),
  validate(
    z.object({
      body: z.object({ teacherId: z.string() }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const teacher = await prisma.teacher.findUnique({
      where: { id: req.body.teacherId },
    });
    if (!teacher) return res.status(404).json({ error: "Teacher not found" });
    res.json(
      await prisma.group.update({
        where: { id: req.params.id },
        data: { teacherId: teacher.id },
        include: { Teacher: true, Direction: true },
      }),
    );
  }),
);
router.use(errorHandler);
export default router;
