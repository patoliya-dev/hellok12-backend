import { body } from 'express-validator';

export const signupValidation = [
  body('role').isIn(['student', 'parent', 'teacher', 'school']).withMessage('Invalid role'),

  body('name').notEmpty().withMessage('Name is required'),
  body('phone').optional(),

  // Conditional email/password only if role is 'student' and no parentId (standalone student)
  body('email')
    .if((value, { req }) => req.body.role === 'student' && !req.body.parent)
    .isEmail()
    .withMessage('Valid email is required for standalone student'),

  body('password')
    .if((value, { req }) => req.body.role === 'student' && !req.body.parent)
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters for standalone student'),

  // Optional children array if parent
  body('children')
    .if((value, { req }) => req.body.role === 'parent')
    .isArray()
    .withMessage('Children must be an array'),

  body('children.*.name')
    .if((value, { req }) => req.body.role === 'parent')
    .notEmpty()
    .withMessage('Child name is required'),

  body('children.*.age')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Child age must be a positive integer'),

  body('children.*.gender')
    .optional()
    .isIn(['male', 'female', 'other'])
    .withMessage('Child gender must be male, female, or other')
];

export const loginValidation = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').exists().withMessage('Password required')
];

export const forgotPasswordValidation = [
  body('email').isEmail().withMessage('Valid email required')
];

export const verifyCodeValidation = [
  body('email').isEmail(),
  body('code').isLength({ min: 6, max: 6 }).withMessage('6-digit code required')
];

export const resetPasswordValidation = [
  body('email').isEmail(),
  body('code').isLength({ min: 6, max: 6 }),
  body('newPassword').isLength({ min: 6 })
];
