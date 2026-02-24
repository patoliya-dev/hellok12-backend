import { Types } from 'mongoose';
import { User } from '../models/user.model';
import { Course } from '../models/course.model';

export type PayoutContext = {
  payeeType: 'teacher' | 'school';
  payee: string | null; // userId of teacher/school
  school: string | null; // school userId if applicable
};

function toObjectIdString(v: any): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return Types.ObjectId.isValid(s) ? s : null;
}

/**
 * Extract payee/school reliably from metadata.
 * Never returns empty strings (prevents CastError on ObjectId fields).
 */
export async function extractPayoutContext(meta: Record<string, string>): Promise<PayoutContext> {
  const payoutReceiverTypeRaw = (meta.payoutReceiverType || '').trim();
  const payoutReceiverType =
    payoutReceiverTypeRaw === 'school'
      ? 'school'
      : payoutReceiverTypeRaw === 'teacher'
        ? 'teacher'
        : null;

  // Priority: payoutReceiverId -> teacherId -> owner inference via course
  const payoutReceiverId =
    toObjectIdString(meta.payoutReceiverId) || toObjectIdString(meta.teacherId);

  // Default
  let payeeType: PayoutContext['payeeType'] = 'teacher';
  let payee: string | null = payoutReceiverId;
  let school: string | null = null;

  // If explicitly school
  if (payoutReceiverType === 'school') {
    payeeType = 'school';
    payee = payoutReceiverId;
    school = payoutReceiverId;
    return { payeeType, payee, school };
  }

  // Teacher flow (explicit or inferred)
  payeeType = 'teacher';
  payee = payoutReceiverId;

  // Infer school from teacher profile if teacherId exists
  if (payee) {
    const teacher = await User.findById(payee).select({ school: 1 }).lean();
    if (teacher?.school) {
      // School teacher payout is handled by school manually.
      // Platform payout target should be the school, not school teacher.
      school = String(teacher.school);
      payeeType = 'school';
      payee = school;
    }
  }

  // Fallback infer school from course ownership
  if (!school) {
    const courseId = toObjectIdString(meta.courseId);
    if (courseId) {
      const course = await Course.findById(courseId).select({ ownerType: 1, ownerId: 1 }).lean();
      if ((course as any)?.ownerType === 'school' && (course as any)?.ownerId) {
        const ownerId = String((course as any).ownerId);
        school = Types.ObjectId.isValid(ownerId) ? ownerId : null;
      }
    }
  }

  return { payeeType, payee, school };
}
