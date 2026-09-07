import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncRoute, requireAuth } from "../../middleware/index.js";
import { uid } from "../../utils/teacherScope.js";

export const attendanceRouter = Router();

attendanceRouter.get(
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
        percentage: records.length ? Math.round((present / records.length) * 100) : 0,
      },
    });
  }),
);
