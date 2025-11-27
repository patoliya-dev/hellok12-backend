// src/modules/bookings/bookings.controller.ts
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import BookingModel from '../../models/booking.model';
import { Course } from '../../models/course.model';
import { Lesson } from '../../models/lesson.model';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse'; // adjust path as needed

/**
 * Create a booking (booking record must exist BEFORE creating PaymentIntent)
 * - validates capacity / trial rules
 * - for trials: atomically decrements Lesson.trialCapacity and toggles flags when 0
 * - creates booking document and returns booking to FE
 *
 * NOTE: We do NOT add the student to sessions here for paid bookings.
 * For trial bookings you may choose to add session(s) now — this function does not add sessions.
 */
export async function createBooking(req: Request, res: Response) {
  try {
    const user = (req as any).user; // from auth middleware
    const body = req.body || {};

    const {
      courseId,
      studentId,
      teacherId,
      amount,
      isTrial = false,
      lessonId,
      location,
      start,
      end,
      meta = {}
    } = body as any;

    if (!courseId) return res.status(400).json(createErrorResponse('Missing course/class id'));

    if (!studentId)
      return res
        .status(400)
        .json({ success: false, code: 'STUDENT_REQUIRED', message: 'studentId required' });

    // Normalize ObjectIds
    const courseObjectId = Types.ObjectId.isValid(courseId) ? new Types.ObjectId(courseId) : null;
    const studentObjectId = Types.ObjectId.isValid(studentId)
      ? new Types.ObjectId(studentId)
      : null;
    const lessonObjectId =
      lessonId && Types.ObjectId.isValid(lessonId) ? new Types.ObjectId(lessonId) : null;
    const teacherObjectId =
      teacherId && Types.ObjectId.isValid(teacherId) ? new Types.ObjectId(teacherId) : null;

    if (!courseObjectId || !studentObjectId)
      return res
        .status(400)
        .json({ success: false, code: 'INVALID_IDS', message: 'Invalid IDs provided' });

    // Load course
    const course = await Course.findById(courseObjectId).lean();
    if (!course)
      return res
        .status(404)
        .json({ success: false, code: 'COURSE_NOT_FOUND', message: 'Course not found' });

    // ENROLL validation: check capacity first (for paid enrollments)
    if (!isTrial) {
      if (course.lessonType === 'group' && typeof course.studentCapacity === 'number') {
        if ((course.enrolledCount || 0) >= course.studentCapacity) {
          return res
            .status(409)
            .json({ success: false, code: 'COURSE_FULL', message: 'Course is full' });
        }
      }
      if (course.lessonType === '1-on-1') {
        if ((course.enrolledCount || 0) >= 1) {
          return res
            .status(409)
            .json({
              success: false,
              code: 'COURSE_FULL',
              message: 'This 1-on-1 course is already taken'
            });
        }
      }
    }

    // TRIAL flow: atomic decrement of lesson.trialCapacity and toggling flags when it hits 0
    let reservedLesson: any = null;
    if (isTrial) {
      // 1) Per-user trial check: if the student already has a trial booking for this course, reject
      const existingTrial = await BookingModel.findOne({
        course: courseObjectId,
        student: studentObjectId,
        isTrial: true
      }).lean();

      if (existingTrial) {
        return res
          .status(409)
          .json({
            success: false,
            code: 'ALREADY_TAKEN_TRIAL',
            message: 'This student has already taken a trial for this course'
          });
      }

      // 2) Atomically reserve a seat on the chosen lesson OR any trial lesson for the course
      if (lessonObjectId) {
        reservedLesson = await Lesson.findOneAndUpdate(
          { _id: lessonObjectId, isTrialAvailable: true, trialCapacity: { $gt: 0 } },
          { $inc: { trialCapacity: -1 } },
          { new: true }
        ).lean();

        if (!reservedLesson) {
          return res
            .status(409)
            .json({
              success: false,
              code: 'TRIAL_CAPACITY_EXHAUSTED',
              message: 'Trial capacity exhausted for selected lesson'
            });
        }
      } else {
        // pick any lesson for this course which has trial capacity
        reservedLesson = await Lesson.findOneAndUpdate(
          { courseId: courseObjectId, isTrialAvailable: true, trialCapacity: { $gt: 0 } },
          { $inc: { trialCapacity: -1 } },
          { new: true }
        ).lean();

        if (!reservedLesson) {
          return res
            .status(409)
            .json({
              success: false,
              code: 'TRIAL_CAPACITY_EXHAUSTED',
              message: 'No trial lessons available for this course'
            });
        }
      }

      // 3) If reservedLesson's trialCapacity reached 0, set its isTrialAvailable = false
      try {
        if (typeof reservedLesson.trialCapacity === 'number' && reservedLesson.trialCapacity <= 0) {
          await Lesson.updateOne(
            { _id: reservedLesson._id },
            { $set: { isTrialAvailable: false } }
          );
        }

        // 4) If no other lessons for this course have trialCapacity > 0 then set course.isTrialAvailable = false
        const remaining = await Lesson.countDocuments({
          courseId: courseObjectId,
          isTrialAvailable: true,
          trialCapacity: { $gt: 0 }
        });
        if (!remaining || remaining === 0) {
          await Course.updateOne({ _id: courseObjectId }, { $set: { isTrialAvailable: false } });
        } else {
          // ensure course flag remains true if others exist
          if (!course.isTrialAvailable) {
            await Course.updateOne({ _id: courseObjectId }, { $set: { isTrialAvailable: true } });
          }
        }
      } catch (flagErr) {
        // If flag update fails, log but continue — we have reserved capacity. FE will show booking success.
        console.warn('Failed to update trial availability flags', flagErr);
      }
    } // end isTrial block

    // Build booking payload
    const bookingPayload: any = {
      student: studentObjectId,
      course: courseObjectId,
      bookedBy: user?._id || studentObjectId,
      isTrial: !!isTrial,
      paymentStatus: isTrial ? 'NOT_REQUIRED' : 'PENDING',
      paymentFlow: isTrial ? 'TRIAL_FREE' : 'DIRECT_SUPER_ADMIN',
      meta: Object.assign({}, meta, { amount: amount || null }),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (teacherObjectId) bookingPayload.bookedForTeacher = teacherObjectId;
    if (location) bookingPayload.location = location;
    if (start) bookingPayload.start = new Date(start);
    if (end) bookingPayload.end = new Date(end);
    if (lessonObjectId) bookingPayload.lesson = lessonObjectId;
    else if (isTrial && reservedLesson && reservedLesson._id)
      bookingPayload.lesson = reservedLesson._id;

    // Create booking doc (booking must exist before PaymentIntent)
    let booking;
    try {
      booking = await BookingModel.create(bookingPayload);
    } catch (createErr) {
      // On booking creation failure, revert reserved trial seat if any
      if (isTrial && reservedLesson && reservedLesson._id) {
        try {
          await Lesson.findByIdAndUpdate(reservedLesson._id, {
            $inc: { trialCapacity: 1 },
            $set: { isTrialAvailable: true }
          });
        } catch (revertErr) {
          console.error('Failed to revert trialCapacity after booking creation failure', revertErr);
        }
      }
      throw createErr;
    }

    // Success response
    return res.status(201).json(createSuccessResponse({ booking, message: 'Booking created' }));
  } catch (err: any) {
    console.error('createBooking error', err);
    return res.status(500).json(createErrorResponse('Internal server error', err?.message || err));
  }
}
