import express from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate, authorizee } from '../middlewares/auth.middleware';
import {
  signupValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyCodeValidation,
  resetPasswordValidation,
} from '../middlewares/validation.middleware';

const router = express.Router();

router.post('/signup', signupValidation, authController.signup);
router.post('/login', loginValidation, authController.login);
router.get('/verify-email', authController.verifyEmail);
router.post('/forgot-password', forgotPasswordValidation, authController.forgotPassword);
router.post('/verify-reset-code', verifyCodeValidation, authController.verifyResetCode);
router.post('/reset-password', resetPasswordValidation, authController.resetPassword);
router.post('/refresh-token', authController.refreshToken);
router.get('/me', authenticate, authController.getCurrentUser);

export default router;
