import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './lib/prisma.js';

const secret = process.env.JWT_SECRET ?? 'replace-with-a-long-random-secret-at-least-16-chars';
const publicUser = { id: true, email: true, firstName: true, lastName: true, phone: true, avatar: true, role: true, status: true } as const;
const id = () => crypto.randomUUID();
export const issueAccessToken = (user: { id: string; role: string }) => jwt.sign({ role: user.role }, secret, { subject: user.id, expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as any });
export async function issueRefreshToken(userId: string) {
  const raw = crypto.randomBytes(48).toString('hex');
  await prisma.refreshToken.create({ data: { id: id(), userId, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? 30) * 86400000) } });
  return raw;
}
export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(password, user.passwordHash))) return null;
  return { user: await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: publicUser }), accessToken: issueAccessToken(user), refreshToken: await issueRefreshToken(user.id) };
}
export async function register(input: { email: string; password: string; firstName: string; lastName: string; phone?: string; role?: 'student' | 'teacher' }) {
  const role = input.role === 'teacher' ? 'TEACHER' : 'STUDENT';
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { id: id(), email: input.email, passwordHash: await bcrypt.hash(input.password, 12), firstName: input.firstName, lastName: input.lastName, phone: input.phone, role, updatedAt: new Date() }, select: publicUser });
    if (role === 'TEACHER') await tx.teacher.create({ data: { id: id(), userId: created.id, fullName: `${created.firstName} ${created.lastName}` } });
    return created;
  });
  return { user, accessToken: issueAccessToken(user), refreshToken: await issueRefreshToken(user.id) };
}
