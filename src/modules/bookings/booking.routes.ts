import express from 'express';
import * as bookingsController from './bookings.controller';
import { authenticate } from '../../middlewares/auth';

const router = express.Router();

router.post('/', authenticate, bookingsController.createBooking);

export default router;
