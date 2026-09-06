import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
const prisma = new PrismaClient();
async function main() {
  const passwordHash = await bcrypt.hash('teacher123', 12);
  const adminPasswordHash = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@asmo.uz' },
    update: { role: 'ADMIN', status: 'ACTIVE' },
    create: { id: crypto.randomUUID(), email: 'admin@asmo.uz', passwordHash: adminPasswordHash, firstName: 'Asmo', lastName: 'Admin', role: 'ADMIN', status: 'ACTIVE', updatedAt: new Date() }
  });
  const teacherUser = await prisma.user.upsert({
    where: { email: 'teacher@asmo.uz' },
    update: { role: 'TEACHER', status: 'ACTIVE' },
    create: { id: crypto.randomUUID(), email: 'teacher@asmo.uz', passwordHash, firstName: 'Jasur', lastName: 'Abdullayev', role: 'TEACHER', status: 'ACTIVE', updatedAt: new Date() }
  });
  const teacher = await prisma.teacher.findFirst({ where: { userId: teacherUser.id } }) ?? await prisma.teacher.findFirst();
  if (teacher) await prisma.teacher.update({ where: { id: teacher.id }, data: { userId: teacherUser.id } });
  console.log('Teacher seed ready: teacher@asmo.uz / teacher123');
}
main().finally(() => prisma.$disconnect());
