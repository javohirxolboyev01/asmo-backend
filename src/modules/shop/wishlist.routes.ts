import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";
import { uid } from "../../utils/teacherScope.js";

export const wishlistRouter = Router();

wishlistRouter.get(
  "/wishlist",
  requireAuth,
  asyncRoute(async (req: any, res: any) =>
    res.json({
      wishlist: (
        await prisma.wishlistItem.findMany({ where: { studentId: uid(req) }, include: { Product: true } })
      ).map((item) => item.Product),
    }),
  ),
);

wishlistRouter.post(
  "/wishlist/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) =>
    res.status(201).json(
      await prisma.wishlistItem.upsert({
        where: { studentId_productId: { studentId: uid(req), productId: req.params.id } },
        update: {},
        create: { id: newId(), studentId: uid(req), productId: req.params.id },
      }),
    ),
  ),
);

wishlistRouter.delete(
  "/wishlist/:id",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    await prisma.wishlistItem.deleteMany({ where: { studentId: uid(req), productId: req.params.id } });
    res.status(204).send();
  }),
);
