import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, idSchema, requireAuth, requireRole, validate } from "../../middleware/index.js";
import { newId } from "../../utils/ids.js";

const staff = ["TEACHER", "ADMIN"];

export const directionsRouter = Router();

directionsRouter.get(
  "/directions",
  requireAuth,
  asyncRoute(async (_req: any, res: any) => {
    const rows = await prisma.direction.findMany({
      include: { _count: { select: { Group: true } } },
      orderBy: { name: "asc" },
    });
    res.json({
      directions: rows.map((x) => ({ id: x.id, name: x.name, color: x.color, groupsCount: x._count.Group })),
    });
  }),
);

directionsRouter.post(
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
    res.status(201).json(
      await prisma.direction.create({ data: { id: newId(), name: req.body.name, color: req.body.color ?? "#3B82F6" } }),
    ),
  ),
);

directionsRouter.patch(
  "/directions/:id",
  requireAuth,
  requireRole(...staff),
  validate(
    z.object({
      body: z.object({ name: z.string().min(2).optional(), color: z.string().optional() }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  asyncRoute(async (req: any, res: any) =>
    res.json(await prisma.direction.update({ where: { id: req.params.id }, data: req.body })),
  ),
);

directionsRouter.delete(
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
