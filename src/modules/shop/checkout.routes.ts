import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";
import { uid } from "../../utils/teacherScope.js";

export const checkoutRouter = Router();

checkoutRouter.post(
  "/shop/checkout",
  requireAuth,
  validate(
    z.object({
      body: z.object({
        productIds: z.array(z.string()).min(1).or(z.undefined()),
        items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).optional(),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) => {
    const ids = req.body.items
      ? req.body.items.flatMap((x: any) => Array(x.quantity).fill(x.productId))
      : req.body.productIds;
    const products = await prisma.product.findMany({ where: { id: { in: ids }, isActive: true } });
    if (products.length !== ids.length) return res.status(400).json({ error: "Product not found" });
    const total = products.reduce((sum, product) => sum + product.price, 0);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: uid(req) } });
      if (user.coinBalance < total)
        throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });
      const purchases = await Promise.all(
        products.map((product) =>
          tx.purchase.create({ data: { id: newId(), studentId: user.id, productId: product.id, price: product.price } }),
        ),
      );
      await tx.coinTransaction.create({
        data: { id: newId(), studentId: user.id, amount: -total, reason: "Do'kondan xarid", sourceType: "SHOP" },
      });
      await tx.user.update({ where: { id: user.id }, data: { coinBalance: { decrement: total } } });
      return { purchases, balance: user.coinBalance - total };
    });
    res.status(201).json({
      message: "Purchase successful",
      purchaseIds: result.purchases.map((x) => x.id),
      balance: result.balance,
    });
  }),
);
