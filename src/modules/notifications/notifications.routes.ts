import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, validate } from "../../middleware/index.js";
import { lower } from "../../utils/serializers.js";
import { uid } from "../../utils/teacherScope.js";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/notifications",
  requireAuth,
  asyncRoute(async (req: any, res: any) =>
    res.json({
      notifications: (
        await prisma.notification.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: "desc" } })
      ).map((item) => ({ ...item, type: lower(item.type) })),
    }),
  ),
);

notificationsRouter.patch(
  "/notifications/read-all",
  requireAuth,
  asyncRoute(async (req: any, res: any) => {
    await prisma.notification.updateMany({ where: { userId: uid(req), isRead: false }, data: { isRead: true } });
    res.json({ success: true });
  }),
);

notificationsRouter.patch(
  "/notifications/:id/read",
  requireAuth,
  validate(idSchema),
  asyncRoute(async (req: any, res: any) => {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: uid(req) },
      data: { isRead: true },
    });
    if (!result.count) return res.status(404).json({ error: "Notification not found" });
    res.json({ success: true });
  }),
);
