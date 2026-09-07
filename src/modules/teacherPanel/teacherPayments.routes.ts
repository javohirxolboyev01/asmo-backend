import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { publicUser } from "../../utils/serializers.js";
import { newId } from "../../utils/ids.js";
import { paymentData } from "../../utils/schemas.js";
import { teacherStudentIds } from "../../utils/teacherScope.js";

export const teacherPaymentsRouter = Router();

const paymentCreate = z.object({
  body: paymentData.extend({ studentId: z.string().min(1) }),
  params: z.object({}),
  query: z.object({}),
});

const paymentUpdate = z.object({
  body: paymentData.partial().refine((body) => Object.keys(body).length > 0, "At least one payment field is required"),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});

teacherPaymentsRouter.get(
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

teacherPaymentsRouter.post(
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

teacherPaymentsRouter.patch(
  "/teacher/payments/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(paymentUpdate),
  asyncRoute(async (req: any, res: any) => {
    const memberships = await teacherStudentIds(req);
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id, studentId: { in: memberships.map((item) => item.studentId) } },
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(
      await prisma.payment.update({ where: { id: payment.id }, data: req.body, include: { User: { select: publicUser } } }),
    );
  }),
);

teacherPaymentsRouter.delete(
  "/teacher/payments/:id",
  requireAuth,
  requireRole("TEACHER"),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const memberships = await teacherStudentIds(req);
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id, studentId: { in: memberships.map((item) => item.studentId) } },
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    await prisma.payment.delete({ where: { id: payment.id } });
    res.status(204).send();
  }),
);
