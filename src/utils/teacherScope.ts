// src/utils/teacherScope.ts — this app only has two roles, TEACHER and
// STUDENT, and TEACHER acts as a full admin (there's no separate admin-only
// data set). So groupScope() is unrestricted for any staff request; teacherId()
// still resolves the requesting teacher's own profile id, used to default the
// "owner" of a group/notification recipient, never as an access restriction.
import { prisma } from "../lib/prisma.js";

export const uid = (req: any) => req.user.id;

export const teacherId = async (req: any) => {
  if (req._teacherId) return req._teacherId as string;
  const teacher = await prisma.teacher.findUnique({ where: { userId: uid(req) } });
  if (!teacher) {
    const error: any = new Error("Teacher profile not found");
    error.status = 403;
    throw error;
  }
  req._teacherId = teacher.id;
  return teacher.id;
};

export const groupScope = async (_req: any) => ({});

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
