// src/utils/serializers.ts — shape Prisma rows into the JSON contracts the frontend expects.

/** Fields safe to expose for any user (never includes passwordHash). */
export const publicUser = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatar: true,
  role: true,
  status: true,
} as const;

export const lower = (value: string | null | undefined) => value?.toLowerCase();

export const userSummary = (user: any) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  avatar: user.avatar ?? null,
  phone: user.phone ?? null,
  role: lower(user.role),
  status: lower(user.status),
  coinBalance: user.coinBalance ?? 0,
});

export const paymentSummary = (payment: any, includeStudent = false) => ({
  id: payment.id,
  orderNumber: payment.orderNumber,
  amountNumber: payment.amountNumber || payment.amount,
  status: lower(payment.status),
  paymentType: lower(payment.paymentType),
  paidAt: payment.paidAt,
  teacherName: payment.teacherName,
  description: payment.description,
  receiptNumber: payment.receiptNumber,
  ...(includeStudent
    ? {
        userId: payment.User?.id ?? payment.studentId,
        studentName: payment.User
          ? `${payment.User.firstName} ${payment.User.lastName}`
          : undefined,
      }
    : {}),
});
