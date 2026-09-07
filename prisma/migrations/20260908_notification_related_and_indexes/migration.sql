-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "relatedId" TEXT;

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_idx" ON "AttendanceRecord"("studentId");

-- CreateIndex
CREATE INDEX "Enrollment_groupId_idx" ON "Enrollment"("groupId");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");
