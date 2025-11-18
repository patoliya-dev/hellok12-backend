// src/modules/bookings/bookings.controller.ts
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import BookingModel from '../../models/booking.model.ts'; // adjust path
import { User } from '../../models/user.model';

// Minimal create booking: persist to Booking model then return booking
export async function createBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ error: 'Unauthorized' });

    const { classId, studentId, date, time, teacherId, amount, isTrial } = req.body;

    // Basic validation
    if (!classId || !studentId || !teacherId) {
      return res.status(400).send({ error: 'Missing required fields' });
    }

    const start = date ? new Date(`${date}T${time || '00:00:00Z'}`) : undefined;

    const bookingToCreate: any = {
      student: studentId,
      teacher: teacherId,
      course: classId,
      bookedBy: userId,
      start: start,
      isTrial: !!isTrial,
      paymentStatus: amount && amount > 0 ? 'PENDING' : 'NOT_REQUIRED',
      meta: { amount },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const booking = await BookingModel.create(bookingToCreate);

    res.json({ success: true, booking });
  } catch (err) {
    next(err);
  }
}
