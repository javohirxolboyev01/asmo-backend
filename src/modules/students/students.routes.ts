import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { lower, paymentSummary, userSummary } from "../../utils/serializers.js";
import { avatarSchema, studentCreate } from "../../utils/schemas.js";
import { newId } from "../../utils/ids.js";
import { uid } from "../../utils/teacherScope.js";
import { register } from "../auth/auth.service.js";

const staff = ["TEACHER", "ADMIN"];

export const studentsRouter = Router();

studentsRouter.get(
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
        ...(req.query.groupId ? { Enrollment: { some: { groupId: String(req.query.groupId) } } } : {}),
      },
      include: { Enrollment: { include: { Group: true } }, AttendanceRecord: true },
    });
    res.json({
      students: rows.map((u) => ({
        ...userSummary(u),
        groups: u.Enrollment.map((e) => ({ id: e.Group.id, name: e.Group.name })),
        attendancePercentage: u.AttendanceRecord.length
          ? Math.round((u.AttendanceRecord.filter((a) => a.status === "PRESENT").length / u.AttendanceRecord.length) * 100)
          : 0,
      })),
    });
  }),
);

studentsRouter.post(
  "/students",
  requireAuth,
  requireRole(...staff),
  validate(studentCreate),
  asyncRoute(async (req: any, res: any) => {
    const result = await register({ ...req.body, role: "student" });
    res.status(201).json(result.user);
  }),
);

studentsRouter.get(
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
    const present = user.AttendanceRecord.filter((a) => a.status === "PRESENT").length;
    res.json({
      student: userSummary(user),
      groups: user.Enrollment.map((e) => ({ id: e.Group.id, name: e.Group.name })),
      attendance: {
        stats: {
          total: user.AttendanceRecord.length,
          present,
          percentage: user.AttendanceRecord.length ? Math.round((present / user.AttendanceRecord.length) * 100) : 0,
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

studentsRouter.patch(
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
    const user = await prisma.user.updateMany({ where: { id: req.params.id, role: "STUDENT" }, data: req.body });
    if (!user.count) return res.status(404).json({ error: "Student not found" });
    res.json(userSummary(await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } })));
  }),
);

// Cascading deletes on User (Enrollment, AttendanceRecord, CoinTransaction,
// Payment, Submission, Notification, RefreshToken) are declared in the Prisma
// schema, so removing the student row cleans up everything that references it.
studentsRouter.delete(
  "/students/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const student = await prisma.user.findFirst({ where: { id: req.params.id, role: "STUDENT" } });
    if (!student) return res.status(404).json({ error: "Student not found" });
    await prisma.user.delete({ where: { id: student.id } });
    res.status(204).send();
  }),
);

studentsRouter.post(
  "/students/:id/coins",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({ amount: z.number().int().refine((x) => x !== 0), reason: z.string().min(1) }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const student = await prisma.user.findFirst({ where: { id: req.params.id, role: "STUDENT" } });
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
      await tx.user.update({ where: { id: student.id }, data: { coinBalance: balance } });
      await tx.notification.create({
        data: { id: newId(), userId: student.id, type: "SYSTEM", title: "Coin balance updated", message: req.body.reason },
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

studentsRouter.post(
  "/students/:id/payments",
  requireAuth,
  requireRole(...staff),
  validate(payCreate),
  asyncRoute(async (req: any, res: any) => {
    const student = await prisma.user.findFirst({ where: { id: req.params.id, role: "STUDENT" } });
    if (!student) return res.status(404).json({ error: "Student not found" });
    const teacher = await prisma.teacher.findUnique({ where: { userId: uid(req) } });
    const status = req.body.status ?? "PENDING";
    const actor = teacher ?? (await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } }));
    const payment = await prisma.payment.create({
      data: {
        id: newId(),
        studentId: student.id,
        amount: req.body.amountNumber,
        amountNumber: req.body.amountNumber,
        orderNumber: (await prisma.payment.count({ where: { studentId: student.id } })) + 1,
        status,
        paymentType: req.body.paymentType,
        description: req.body.description,
        receiptNumber: req.body.receiptNumber,
        dueDate: new Date(),
        teacherName: teacher?.fullName ?? `${(actor as any).firstName} ${(actor as any).lastName}`,
        paidAt: status === "PAID" ? new Date() : null,
      },
    });
    res.status(201).json(paymentSummary(payment));
  }),
);
