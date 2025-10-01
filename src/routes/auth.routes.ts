import express from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { validateRequest } from '../middlewares/validation';
import {
  studentRegistrationSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema
} from '../schemas/auth.schemas';

const router = express.Router();

router.post('/signup', validateRequest(studentRegistrationSchema), authController.signup);
router.post('/login', validateRequest(loginSchema), authController.login);
router.get('/verify-email', authController.verifyEmail);
router.post(
  '/forgot-password',
  validateRequest(forgotPasswordSchema),
  authController.forgotPassword
);
router.post(
  '/verify-reset-code',
  validateRequest(verifyResetCodeSchema),
  authController.verifyResetCode
);
router.post('/reset-password', validateRequest(resetPasswordSchema), authController.resetPassword);
router.post('/refresh-token', authController.refreshToken);
router.get('/me', authenticate, authController.getCurrentUser);

export default router;
