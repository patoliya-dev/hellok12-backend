import { z } from 'zod';

// Common validation patterns
const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .transform(email => email.toLowerCase().trim());

const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password cannot exceed 128 characters');

const strongPasswordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password cannot exceed 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one uppercase letter, lowercase letter, and number'
  );

const phoneSchema = z
  .string()
  .min(1, 'Phone number is required')
  .regex(/^\+?[1-9]\d{0,15}$/, 'Please enter a valid phone number')
  .transform(phone => phone.trim());

const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name cannot exceed 100 characters')
  .transform(name => name.trim());

const optionalPhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{0,15}$/, 'Please enter a valid phone number')
  .transform(phone => phone.trim())
  .optional();

// Child validation schema (for parent registration)
const childSchema = z.object({
  id: z.string().optional(), // UUID from frontend
  name: nameSchema,
  age: z.union([
    z
      .number()
      .int()
      .min(3, 'Child must be at least 3 years old')
      .max(18, 'Child must be under 18 years old'),
    z.string().transform(val => {
      const num = parseInt(val, 10);
      if (isNaN(num)) throw new Error('Age must be a valid number');
      if (num < 3) throw new Error('Child must be at least 3 years old');
      if (num > 18) throw new Error('Child must be under 18 years old');
      return num;
    })
  ]),
  gender: z.enum(['male', 'female', 'other'], {
    error: () => ({ message: 'Please select a valid gender' })
  })
});

// Base registration schema (matches your frontend structure)
const baseRegistrationSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: strongPasswordSchema,
  termsAccepted: z.boolean().refine(val => val === true, {
    message: 'You must accept the terms and conditions'
  }),
  marketingConsent: z.boolean().optional().default(false)
});

export const registrationSchema = z.object({
  body: baseRegistrationSchema
    .extend({
      // Role selection (matches your frontend)
      role: z.enum(['student', 'parent', 'teacher', 'school'], {
        error: () => ({ message: 'Please select a valid role' })
      }),

      // Children array for parent registration
      children: z.array(childSchema).optional(),

      // School-specific fields
      schoolName: z
        .string()
        .min(2, 'School name is required')
        .max(100, 'School name cannot exceed 100 characters')
        .optional(),

      // Optional fields for all types
      grade: z.string().optional(),
      bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional(),
      experience: z
        .union([
          z.number().int().min(0).max(50),
          z.string().transform(val => {
            const num = parseInt(val, 10);
            if (isNaN(num)) return 0;
            return Math.max(0, Math.min(50, num));
          })
        ])
        .optional(),
      languages: z.array(z.string()).optional(),
      employmentType: z.enum(['independent', 'school_employee']).optional(),
      hourlyRate: z
        .union([
          z.number().positive(),
          z.string().transform(val => {
            const num = parseFloat(val);
            if (isNaN(num) || num <= 0) return undefined;
            return num;
          })
        ])
        .optional(),
      address: z
        .string()
        .min(5, 'Address is required')
        .max(200, 'Address cannot exceed 200 characters')
        .optional(),
      description: z.string().max(1000, 'Description cannot exceed 1000 characters').optional(),
      website: z.string().url('Please enter a valid website URL').optional()
    })
    .superRefine((data, ctx) => {
      // Role-specific validation
      if (data.role === 'parent') {
        // If parent, validate children
        if (data.role === 'parent') {
          if (!data.children || data.children.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Please add at least one student',
              path: ['children']
            });
          }

          // Validate address for parents
          if (!data.address || data.address.trim().length < 5) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Address is required for parents',
              path: ['address']
            });
          }
        }
      }

      // School validation
      if (data.role === 'school') {
        if (!data.schoolName || data.schoolName.trim().length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'School name is required',
            path: ['schoolName']
          });
        }

        if (!data.address || data.address.trim().length < 5) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'School address is required',
            path: ['address']
          });
        }
      }

      // Teacher validation
      if (data.role === 'teacher') {
        // No additional required fields for teacher basic registration
        // Optional fields are handled by the optional() modifiers
      }
    })
});

// Individual role schemas (for specific endpoints if needed)
export const studentRegistrationSchema = z.object({
  body: baseRegistrationSchema.extend({
    grade: z.string().optional()
  })
});

export const parentRegistrationSchema = z.object({
  body: baseRegistrationSchema.extend({
    address: z.string().min(5, 'Address is required').max(200),
    children: z.array(childSchema).min(1, 'At least one child must be added')
  })
});

export const teacherRegistrationSchema = z.object({
  body: baseRegistrationSchema.extend({
    bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional(),
    experience: z
      .union([z.number().int().min(0).max(50), z.string().transform(val => parseInt(val, 10) || 0)])
      .optional(),
    languages: z.array(z.string()).min(1, 'At least one language is required').optional(),
    employmentType: z.enum(['independent', 'school_employee']).default('independent'),
    hourlyRate: z
      .union([z.number().positive(), z.string().transform(val => parseFloat(val) || undefined)])
      .optional()
  })
});

export const schoolRegistrationSchema = z.object({
  body: baseRegistrationSchema.extend({
    schoolName: z.string().min(2, 'School name is required').max(100),
    address: z.string().min(5, 'School address is required').max(200),
    description: z.string().max(1000).optional(),
    website: z.string().url('Please enter a valid website URL').optional()
  })
});

// Login schema
export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
    rememberMe: z.boolean().optional().default(false)
  })
});

// Password reset schemas
export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailSchema
  })
});

export const verifyResetCodeSchema = z.object({
  body: z.object({
    email: emailSchema,
    code: z
      .string()
      .length(6, 'Verification code must be 6 digits')
      .regex(/^\d{6}$/, 'Verification code must be 6 digits')
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: emailSchema,
    code: z
      .string()
      .length(6, 'Verification code must be 6 digits')
      .regex(/^\d{6}$/, 'Verification code must be 6 digits'),
    newPassword: strongPasswordSchema
  })
});

// Change password schema (for authenticated users)
export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: strongPasswordSchema
  })
});

// Update profile schema
export const updateProfileSchema = z.object({
  body: z
    .object({
      name: nameSchema.optional(),
      phone: optionalPhoneSchema,
      bio: z.string().max(500).optional(),
      experience: z.number().int().min(0).max(50).optional(),
      languages: z.array(z.string()).optional(),
      hourlyRate: z.number().positive().optional(),
      address: z.string().min(5).max(200).optional(),
      website: z.string().url().optional(),
      description: z.string().max(1000).optional(),
      grade: z.string().optional(),
      employmentType: z.enum(['independent', 'school_employee']).optional(),
      marketingConsent: z.boolean().optional()
    })
    .strict()
});

// Type exports for TypeScript
export type RegistrationInput = z.infer<typeof registrationSchema>['body'];
export type StudentRegistrationInput = z.infer<typeof studentRegistrationSchema>['body'];
export type ParentRegistrationInput = z.infer<typeof parentRegistrationSchema>['body'];
export type TeacherRegistrationInput = z.infer<typeof teacherRegistrationSchema>['body'];
export type SchoolRegistrationInput = z.infer<typeof schoolRegistrationSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type VerifyResetCodeInput = z.infer<typeof verifyResetCodeSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>['body'];
export type ChildInput = z.infer<typeof childSchema>;
