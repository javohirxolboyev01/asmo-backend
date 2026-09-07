// src/utils/teacherScope.ts — every teacher-panel query is scoped to that
// teacher's own groups; ADMIN sees everything.
import { prisma } from "../lib/prisma.js";

export const uid = (req: any) => req.user.id;

export const teacherId = async (req: any) => {
  const teacher = await prisma.teacher.findUnique({ where: { userId: uid(req) } });
  if (!teacher) {
    const error: any = new Error("Teacher profile not found");
    error.status = 403;
    throw error;
  }
  return teacher.id;
};

export const groupScope = async (req: any) =>
  req.user.role === "ADMIN" ? {} : { teacherId: await teacherId(req) };

export const teacherGroup = async (req: any, groupId: string) =>
  prisma.group.findFirst({ where: { id: groupId, ...(await groupScope(req)) } });

export const teacherStudentIds = async (req: any) => {
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
