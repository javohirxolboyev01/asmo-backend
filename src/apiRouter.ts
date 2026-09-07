// src/apiRouter.ts — mounts every domain module's router under /api.
import { Router } from "express";
import { errorHandler } from "./middleware/index.js";

import { authRouter } from "./modules/auth/auth.routes.js";
import { profileRouter } from "./modules/profile/profile.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { groupsRouter } from "./modules/groups/groups.routes.js";
import { lessonsRouter } from "./modules/lessons/lessons.routes.js";
import { homeworkRouter } from "./modules/homework/homework.routes.js";
import { submissionsRouter } from "./modules/submissions/submissions.routes.js";
import { attendanceRouter } from "./modules/attendance/attendance.routes.js";
import { coinsRouter } from "./modules/coins/coins.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { productsRouter } from "./modules/shop/products.routes.js";
import { wishlistRouter } from "./modules/shop/wishlist.routes.js";
import { checkoutRouter } from "./modules/shop/checkout.routes.js";
import { paymentsRouter } from "./modules/payments/payments.routes.js";
import { directionsRouter } from "./modules/directions/directions.routes.js";
import { teachersRouter } from "./modules/teachers/teachers.routes.js";
import { studentsRouter } from "./modules/students/students.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import {
  teacherAttendanceRouter,
  teacherCoinsRouter,
  teacherDashboardRouter,
  teacherGroupsRouter,
  teacherHomeworkRouter,
  teacherLessonsRouter,
  teacherPaymentsRouter,
  teacherSubmissionsRouter,
} from "./modules/teacherPanel/index.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok", service: "asmo-student-backend" }));

router.use(authRouter);
router.use(profileRouter);
router.use(dashboardRouter);
router.use(groupsRouter);
router.use(lessonsRouter);
router.use(homeworkRouter);
router.use(submissionsRouter);
router.use(attendanceRouter);
router.use(coinsRouter);
router.use(notificationsRouter);
router.use(productsRouter);
router.use(wishlistRouter);
router.use(checkoutRouter);
router.use(paymentsRouter);
router.use(directionsRouter);
router.use(teachersRouter);
router.use(studentsRouter);
router.use(adminRouter);

// Teacher panel: every route here is scoped to the authenticated teacher's own groups.
router.use(teacherDashboardRouter);
router.use(teacherGroupsRouter);
router.use(teacherLessonsRouter);
router.use(teacherHomeworkRouter);
router.use(teacherSubmissionsRouter);
router.use(teacherAttendanceRouter);
router.use(teacherCoinsRouter);
router.use(teacherPaymentsRouter);

router.use(errorHandler);

export default router;
