import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth } from "../../middleware/index.js";
import { uid } from "../../utils/teacherScope.js";

export const coinsRouter = Router();

coinsRouter.get(
  "/coins",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    if (current.role === "STUDENT") {
      const transactions = await prisma.coinTransaction.findMany({
        where: { studentId: current.id },
        orderBy: { createdAt: "desc" },
      });
      return res.json({
        balance: current.coinBalance,
        transactions: transactions.map(({ id, amount, reason, createdAt }) => ({ id, amount, reason, createdAt })),
      });
    }
    const transactions = await prisma.coinTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { User: true },
    });
    res.json({
      transactions: transactions.map(({ id, studentId, amount, reason, createdAt, User }) => ({
        id,
        userId: studentId,
        studentName: `${User.firstName} ${User.lastName}`,
        amount,
        reason,
        createdAt,
      })),
    });
  }),
);

coinsRouter.get(
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
