import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { paymentSummary } from "../../utils/serializers.js";
import { uid } from "../../utils/teacherScope.js";

const staff = ["TEACHER", "ADMIN"];

export const paymentsRouter = Router();

const payUpdate = z.object({
  body: z.object({
    amountNumber: z.number().int().positive().optional(),
    status: z.enum(["PAID", "PENDING", "OVERDUE", "CANCELLED"]).optional(),
    paymentType: z.enum(["CASH", "CLICK", "PAYME", "BANK", "UZUM"]).optional(),
    description: z.string().nullable().optional(),
    receiptNumber: z.string().nullable().optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}),
});

paymentsRouter.get(
  "/payments",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    const payments = await prisma.payment.findMany({
      where: current.role === "STUDENT" ? { studentId: current.id } : {},
      include: { User: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ payments: payments.map((payment) => paymentSummary(payment, current.role !== "STUDENT")) });
  }),
);

paymentsRouter.patch(
  "/payments/:id",
  requireAuth,
  requireRole(...staff),
  validate(payUpdate),
  asyncRoute(async (req: any, res: any) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
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

paymentsRouter.delete(
  "/payments/:id",
  requireAuth,
  requireRole(...staff),
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.payment.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
