import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
const prisma = new PrismaClient();
async function main() {
  const passwordHash = await bcrypt.hash('000000', 12);
  const adminPasswordHash = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@asmo.uz' },
    update: { role: 'ADMIN', status: 'ACTIVE' },
    create: { id: crypto.randomUUID(), email: 'admin@asmo.uz', passwordHash: adminPasswordHash, firstName: 'Asmo', lastName: 'Admin', role: 'ADMIN', status: 'ACTIVE', updatedAt: new Date() }
  });
  const teacherUser = await prisma.user.upsert({
    where: { email: 'bekjon2000@gmail.com' },
    update: { passwordHash, role: 'TEACHER', status: 'ACTIVE', firstName: 'Bekjon', lastName: 'Teacher', updatedAt: new Date() },
    create: { id: crypto.randomUUID(), email: 'bekjon2000@gmail.com', passwordHash, firstName: 'Bekjon', lastName: 'Teacher', role: 'TEACHER', status: 'ACTIVE', updatedAt: new Date() }
  });
  await prisma.teacher.upsert({
    where: { userId: teacherUser.id },
    update: { fullName: `${teacherUser.firstName} ${teacherUser.lastName}` },
    create: { id: crypto.randomUUID(), fullName: `${teacherUser.firstName} ${teacherUser.lastName}`, userId: teacherUser.id }
  });
  console.log('Teacher seed ready: bekjon2000@gmail.com / 000000');
}
main().finally(() => prisma.$disconnect());
