import { Request, Response, NextFunction } from 'express';
import Booking from '../../models/booking.model';
import { Course } from '../../models/course.model';
import { Lesson as LessonModel } from '../../models/lesson.model';
import { User } from '../../models/user.model';

// NOTE: Adjust import paths above to match your project structure if necessary.

export async function createBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const {
      courseId,
      studentId: bodyStudentId,
      teacherId,
      amount,
      isTrial = false,
      lessonId
    } = req.body || {};

    // Determine student: if requester is parent they MUST pass studentId,
    // otherwise use logged-in user's id.
    const requestingUser = await User.findById(userId).lean();
    if (!requestingUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let studentId = bodyStudentId;
    if (requestingUser.role === 'parent') {
      if (!studentId) {
        return res
          .status(400)
          .json({
            success: false,
            code: 'STUDENT_REQUIRED',
            message: 'studentId is required for parent users'
          });
      }
      // Optional: validate that this student belongs to this parent
      const rawChildren = await User.find({ parent: userId }).lean();
      const childrenArray = Array.isArray(rawChildren)
        ? rawChildren
        : rawChildren
          ? [rawChildren]
          : [];
      const childFound = childrenArray.some((c: any) => {
        const id = c && ((c as any)._id ?? c);
        return String(id) === String(studentId);
      });
      if (!childFound) {
        return res
          .status(403)
          .json({
            success: false,
            code: 'INVALID_STUDENT',
            message: 'Selected student does not belong to parent account'
          });
      }
    } else {
      // if not parent and no studentId provided, default to current user
      if (!studentId) studentId = userId;
    }

    // Basic validations
    if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required' });

    const course = await Course.findById(courseId).lean();
    if (!course)
      return res
        .status(404)
        .json({ success: false, code: 'COURSE_NOT_FOUND', message: 'Course not found' });

    // Validate capacity BEFORE creating booking.
    // For group: enrolledCount < studentCapacity
    if (course.lessonType === 'group') {
      const cap = Number(course.studentCapacity || 0);
      const enrolled = Number(course.enrolledCount || 0);
      if (enrolled >= cap) {
        return res
          .status(409)
          .json({ success: false, code: 'COURSE_FULL', message: 'Course is full' });
      }
    }

    // For 1-on-1: only one allowed
    if (course.lessonType === '1-on-1') {
      const enrolled = Number(course.enrolledCount || 0);
      if (enrolled >= 1) {
        return res
          .status(409)
          .json({
            success: false,
            code: 'COURSE_FULL',
            message: 'This 1-on-1 course is already taken'
          });
      }
    }

    // If this is a trial booking, validate lesson & trial capacity & prior trial usage
    if (isTrial) {
      if (!lessonId) {
        return res
          .status(400)
          .json({
            success: false,
            code: 'LESSON_REQUIRED',
            message: 'lessonId is required for trial bookings'
          });
      }

      // Ensure user (student) hasn't already taken a trial for this course
      const existingTrial = await Booking.findOne({
        course: courseId,
        student: studentId,
        isTrial: true
      }).lean();

      if (existingTrial) {
        return res
          .status(409)
          .json({
            success: false,
            code: 'ALREADY_TAKEN_TRIAL',
            message: 'Trial already used for this course by the selected student'
          });
      }

      // Atomically decrement lesson.trialCapacity if available
      const lesson = await LessonModel.findOneAndUpdate(
        {
          _id: lessonId,
          courseId: courseId,
          isTrialAvailable: true,
          trialCapacity: { $gt: 0 }
        },
        { $inc: { trialCapacity: -1 } },
        { new: true }
      ).lean();

      if (!lesson) {
        return res
          .status(409)
          .json({
            success: false,
            code: 'TRIAL_CAPACITY_EXHAUSTED',
            message: 'No trial capacity left for this lesson'
          });
      }
    } else {
      // For paid enrollments: optionally check trial flags or anything else here
      // We do NOT increment course.enrolledCount here — increment happens on payment success webhook
    }

    // Create booking BEFORE payment as required (booking will be reconciled by webhook)
    const bookingPayload: any = {
      student: studentId,
      course: courseId,
      bookedBy: userId,
      isTrial: !!isTrial,
      meta: { amount: amount || 0, lessonId: lessonId || null },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (isTrial) {
      bookingPayload.paymentStatus = 'NOT_REQUIRED';
      bookingPayload.paymentFlow = 'TRIAL_FREE';
      bookingPayload.paymentStatus = 'PAID'; // trial considered paid / consumed
    } else {
      bookingPayload.paymentStatus = 'PENDING';
      bookingPayload.paymentFlow = 'DIRECT_SUPER_ADMIN';
    }

    const booking = await Booking.create(bookingPayload);

    // Response shape: provide booking id and minimal info so FE can create PaymentIntent next
    return res.json({
      success: true,
      booking: {
        _id: booking._id,
        student: booking.student,
        course: booking.course,
        isTrial: booking.isTrial,
        paymentStatus: booking.paymentStatus,
        paymentFlow: booking.paymentFlow,
        meta: booking.meta,
        createdAt: booking.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
}

export default { createBooking };
