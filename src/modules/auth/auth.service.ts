import { User, IUser } from '../../models/user.model';
import { PasswordResetToken } from '../../models/passwordResetToken.model';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { randomInt } from 'crypto';
import { emailService } from '../../utils/email.service';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.util';
import Logger from '../../utils/winstonLogger.utils';
import {
  RegistrationInput,
  StudentRegistrationInput,
  ParentRegistrationInput,
  TeacherRegistrationInput,
  SchoolRegistrationInput
} from './auth.schemas';

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    isVerified: boolean;
    children?: any[];
    profile?: any;
    schoolName?: string;
  };
  accessToken?: string;
  refreshToken?: string;
  requiresEmailVerification?: boolean;
  requiresAdminApproval?: boolean;
  redirectUrl?: string;
}

export interface RegistrationResult {
  user: IUser;
  children?: IUser[];
  requiresEmailVerification: boolean;
  verificationEmailSent: boolean;
  message: string;
}

export const authService = {
  // Main registration handler (matches your frontend role selection flow)
  registerUser: async (data: RegistrationInput): Promise<RegistrationResult> => {
    try {
      const { role, ...otherData } = data;

      Logger.info('Processing registration', { role, email: data.email });

      // Route to appropriate registration method based on final role
      switch (role) {
        case 'student':
          return await authService.registerStudent(otherData as StudentRegistrationInput);
        case 'parent':
          return await authService.registerParent(otherData as ParentRegistrationInput);
        case 'teacher':
          return await authService.registerTeacher(otherData as TeacherRegistrationInput);
        case 'school':
          return await authService.registerSchool(otherData as SchoolRegistrationInput);
        default:
          throw new Error('Invalid role specified');
      }
    } catch (error) {
      Logger.error('Registration failed:', error);
      throw error;
    }
  },

  // Student Registration (matches PDF Student Form)
  registerStudent: async (data: StudentRegistrationInput): Promise<RegistrationResult> => {
    try {
      // Check if email already exists
      const existingUser = await User.findOne({ email: data.email.toLowerCase() });
      if (existingUser) {
        throw new Error('An account with this email already exists');
      }

      const userData: Partial<IUser> = {
        name: data.name,
        email: data.email.toLowerCase(),
        password: data.password,
        role: 'student',
        phone: data.phone,
        isVerified: false,
        termsAccepted: data.termsAccepted,
        marketingConsent: data.marketingConsent || false,
        profile: {
          grade: data.grade,
          registrationSource: 'direct' // Independent student
        }
      };

      const user = new User(userData);
      await user.save();

      // Send student-specific verification email
      const verificationToken = generateRefreshToken({
        id: user._id.toString(),
        action: 'verify'
      });

      await emailService.sendStudentVerificationEmail(user.email!, verificationToken, user.name);

      Logger.info('Student registered successfully', {
        userId: user._id,
        email: user.email
      });

      return {
        user,
        requiresEmailVerification: true,
        verificationEmailSent: true,
        message:
          'Student account created successfully. Please check your email to verify your account.'
      };
    } catch (error) {
      Logger.error('Student registration failed:', error);
      throw error;
    }
  },

  // Parent Registration (matches PDF Parent Form with Children)
  registerParent: async (data: ParentRegistrationInput): Promise<RegistrationResult> => {
    try {
      // Check if email already exists
      const existingUser = await User.findOne({ email: data.email.toLowerCase() });
      if (existingUser) {
        throw new Error('An account with this email already exists');
      }

      // Create parent user (matches PDF Parent/Guardian Information section)
      const parentData: Partial<IUser> = {
        name: data.name,
        email: data.email.toLowerCase(),
        password: data.password,
        role: 'parent',
        phone: data.phone,
        isVerified: false,
        termsAccepted: data.termsAccepted,
        marketingConsent: data.marketingConsent || false,
        profile: {
          address: data.address,
          registrationSource: 'parent_with_children'
        }
      };

      const parent = new User(parentData);
      await parent.save();

      // Create children (matches PDF Student Information section)
      const children: IUser[] = [];
      const childIds: Types.ObjectId[] = [];

      for (let i = 0; i < data.children.length; i++) {
        const childData = data.children[i];
        const childUser = new User({
          name: childData.name,
          role: 'student',
          parent: parent._id,
          isVerified: true, // Children are auto-verified through parent
          termsAccepted: true, // Inherited from parent
          profile: {
            age: childData.age,
            gender: childData.gender,
            registrationSource: 'parent_created',
            childIndex: i + 1 // Child 1, Child 2, etc. (from PDF)
          }
        });

        await childUser.save();
        children.push(childUser);
        childIds.push(childUser._id);
      }

      // Update parent with children IDs
      parent.children = childIds;
      await parent.save();

      // Send parent-specific verification email
      const verificationToken = generateRefreshToken({
        id: parent._id.toString(),
        action: 'verify'
      });

      await emailService.sendParentVerificationEmail(
        parent.email!,
        verificationToken,
        parent.name,
        children.length
      );

      Logger.info('Parent registered successfully', {
        parentId: parent._id,
        childrenCount: children.length
      });

      return {
        user: parent,
        children,
        requiresEmailVerification: true,
        verificationEmailSent: true,
        message: `Parent account created successfully with ${children.length} student${children.length > 1 ? 's' : ''}. Please check your email to verify your account.`
      };
    } catch (error) {
      Logger.error('Parent registration failed:', error);
      throw error;
    }
  },

  // Teacher Registration (matches PDF Teacher Form)
  registerTeacher: async (data: TeacherRegistrationInput): Promise<RegistrationResult> => {
    try {
      const existingUser = await User.findOne({ email: data.email.toLowerCase() });
      if (existingUser) {
        throw new Error('An account with this email already exists');
      }

      const userData: Partial<IUser> = {
        name: data.name,
        email: data.email.toLowerCase(),
        password: data.password,
        role: 'teacher',
        phone: data.phone,
        isVerified: false,
        termsAccepted: data.termsAccepted,
        marketingConsent: data.marketingConsent || false,
        profile: {
          bio: data.bio,
          experience: data.experience || 0,
          languages: data.languages || [],
          employmentType: data.employmentType || 'independent',
          hourlyRate: data.hourlyRate,
          registrationSource: 'teacher_application'
        }
      };

      const user = new User(userData);
      await user.save();

      // Send teacher-specific verification email
      const verificationToken = generateRefreshToken({
        id: user._id.toString(),
        action: 'verify'
      });

      await emailService.sendTeacherVerificationEmail(user.email!, verificationToken, user.name);

      Logger.info('Teacher registered successfully', { userId: user._id });

      return {
        user,
        requiresEmailVerification: true,
        verificationEmailSent: true,
        message:
          'Teacher account created successfully. Please check your email to verify your account and start teaching!'
      };
    } catch (error) {
      Logger.error('Teacher registration failed:', error);
      throw error;
    }
  },

  // School Registration (matches PDF School Form)
  registerSchool: async (data: SchoolRegistrationInput): Promise<RegistrationResult> => {
    try {
      const existingUser = await User.findOne({ email: data.email.toLowerCase() });
      if (existingUser) {
        throw new Error('An account with this email already exists');
      }

      const userData: Partial<IUser> = {
        name: data.name, // Contact person name
        email: data.email.toLowerCase(),
        password: data.password,
        role: 'school',
        phone: data.phone,
        isVerified: false,
        termsAccepted: data.termsAccepted,
        marketingConsent: data.marketingConsent || false,
        profile: {
          schoolName: data.schoolName,
          address: data.address,
          description: data.description,
          website: data.website,
          registrationSource: 'school_application',
          status: 'pending_approval' // Schools need admin approval
        }
      };

      const user = new User(userData);
      await user.save();

      // Send school-specific verification email
      const verificationToken = generateRefreshToken({
        id: user._id.toString(),
        action: 'verify'
      });

      await emailService.sendSchoolVerificationEmail(
        user.email!,
        verificationToken,
        data.schoolName
      );

      Logger.info('School registered successfully', {
        userId: user._id,
        schoolName: data.schoolName
      });

      return {
        user,
        requiresEmailVerification: true,
        verificationEmailSent: true,
        message:
          'School account created successfully. Please verify your email and wait for admin approval to start managing your school.'
      };
    } catch (error) {
      Logger.error('School registration failed:', error);
      throw error;
    }
  },

  // Login (matches PDF Sign In flow)
  login: async (
    email: string,
    password: string,
    rememberMe: boolean = false
  ): Promise<AuthResult> => {
    try {
      const user = await User.findOne({ email: email.toLowerCase() }).populate(
        'children',
        'name profile.age profile.gender'
      );

      if (!user) {
        throw new Error('Invalid credentials'); // Matches PDF "Wrong password" message
      }

      if (!user.isVerified) {
        throw new Error('Email not verified'); // Triggers email verification flow
      }

      const isPasswordValid = await bcrypt.compare(password, user.password || '');

      if (!isPasswordValid) {
        throw new Error('Invalid credentials'); // Matches PDF "Wrong password" message
      }

      // Check account status
      if (user.role === 'school' && user.profile?.status === 'pending_approval') {
        throw new Error('School account is pending admin approval');
      }

      // Generate tokens with appropriate expiry
      const accessTokenExpiry = rememberMe ? '7d' : '24h'; // Access token
      const refreshTokenExpiry = rememberMe ? '90d' : '30d'; // Refresh token

      const accessToken = generateToken(
        {
          id: user._id.toString(),
          role: user.role
        },
        accessTokenExpiry
      );

      const refreshToken = generateRefreshToken(
        {
          id: user._id.toString(),
          rememberMe
        },
        refreshTokenExpiry
      );

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Determine redirect URL based on role (matches PDF dashboard routing)
      let redirectUrl = '/dashboard';
      switch (user.role) {
        case 'student':
        case 'parent':
          redirectUrl = '/student-parent/dashboard';
          break;
        case 'teacher':
          redirectUrl = '/teacher/dashboard';
          break;
        case 'school':
          redirectUrl = '/school/dashboard';
          break;
        default:
          redirectUrl = '/dashboard';
      }

      Logger.info('User logged in successfully', {
        userId: user._id,
        role: user.role,
        rememberMe
      });

      return {
        user: {
          id: user._id.toString(),
          email: user.email!,
          name: user.name,
          role: user.role,
          isVerified: user.isVerified,
          children: user.role === 'parent' ? user.children : undefined,
          profile: user.profile,
          schoolName: user.profile?.schoolName
        },
        accessToken,
        refreshToken,
        redirectUrl
      };
    } catch (error) {
      Logger.error('Login failed:', error);
      throw error;
    }
  },

  // Email Verification (matches PDF email verification flow)
  verifyEmail: async (token: string): Promise<AuthResult> => {
    try {
      const decoded = verifyRefreshToken(token);
      if (decoded.action !== 'verify') {
        throw new Error('Invalid verification token');
      }

      const user = await User.findById(decoded.id).populate(
        'children',
        'name profile.age profile.gender'
      );

      if (!user) {
        throw new Error('User not found');
      }

      if (user.isVerified) {
        // Already verified, return login tokens
        const accessToken = generateToken({
          id: user._id.toString(),
          role: user.role
        });
        const refreshToken = generateRefreshToken({
          id: user._id.toString()
        });

        return {
          user: {
            id: user._id.toString(),
            email: user.email!,
            name: user.name,
            role: user.role,
            isVerified: user.isVerified,
            children: user.role === 'parent' ? user.children : undefined,
            profile: user.profile
          },
          accessToken,
          refreshToken
        };
      }

      // Mark user as verified
      user.isVerified = true;
      await user.save();

      // Send welcome email after verification
      await emailService.sendWelcomeEmail(user.email!, user.name, user.role);

      // Generate login tokens for immediate login after verification
      const accessToken = generateToken({
        id: user._id.toString(),
        role: user.role
      });
      const refreshToken = generateRefreshToken({
        id: user._id.toString()
      });

      Logger.info('Email verified successfully', { userId: user._id });

      return {
        user: {
          id: user._id.toString(),
          email: user.email!,
          name: user.name,
          role: user.role,
          isVerified: user.isVerified,
          children: user.role === 'parent' ? user.children : undefined,
          profile: user.profile
        },
        accessToken,
        refreshToken
      };
    } catch (error) {
      Logger.error('Email verification failed:', error);
      throw new Error('Invalid or expired verification token');
    }
  },

  // Resend Verification Email (matches PDF "Resend Verification Email" button)
  resendVerificationEmail: async (email: string): Promise<void> => {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        throw new Error('User not found');
      }

      if (user.isVerified) {
        throw new Error('Email is already verified');
      }

      const verificationToken = generateRefreshToken({
        id: user._id.toString(),
        action: 'verify'
      });

      // Send role-specific verification email
      switch (user.role) {
        case 'student':
          await emailService.sendStudentVerificationEmail(
            user.email!,
            verificationToken,
            user.name
          );
          break;
        case 'parent': {
          const childrenCount = user.children?.length || 0;
          await emailService.sendParentVerificationEmail(
            user.email!,
            verificationToken,
            user.name,
            childrenCount
          );
          break;
        }
        case 'teacher':
          await emailService.sendTeacherVerificationEmail(
            user.email!,
            verificationToken,
            user.name
          );
          break;
        case 'school':
          await emailService.sendSchoolVerificationEmail(
            user.email!,
            verificationToken,
            user.profile?.schoolName || user.name
          );
          break;
        default:
          await emailService.sendVerificationEmail(user.email!, verificationToken, user.name);
      }

      Logger.info('Verification email resent', { userId: user._id });
    } catch (error) {
      Logger.error('Failed to resend verification email:', error);
      throw error;
    }
  },

  // Forgot Password (matches PDF "Forgot your password?" flow)
  forgotPassword: async (email: string): Promise<void> => {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        throw new Error('No account found with this email address');
      }

      const code = randomInt(100000, 999999).toString(); // 6-digit code as shown in PDF
      const expiryTime = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Remove any existing reset tokens for this user
      await PasswordResetToken.deleteMany({ user: user._id });

      // Create new reset token
      await PasswordResetToken.create({
        user: user._id,
        code,
        expiresAt: expiryTime
      });

      // Send password reset code (matches PDF "Verify code" step)
      await emailService.sendPasswordResetCode(user.email!, user.name, code);

      Logger.info('Password reset code sent', { userId: user._id });
    } catch (error) {
      Logger.error('Forgot password failed:', error);
      throw error;
    }
  },

  // Verify Reset Code (matches PDF "Enter Code" verification step)
  verifyResetCode: async (email: string, code: string): Promise<IUser> => {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        throw new Error('User not found');
      }

      const tokenDoc = await PasswordResetToken.findOne({
        user: user._id,
        code
      });

      if (!tokenDoc) {
        throw new Error('Invalid verification code');
      }

      if (new Date() > tokenDoc.expiresAt) {
        await PasswordResetToken.deleteOne({ _id: tokenDoc._id });
        throw new Error('Verification code has expired');
      }

      Logger.info('Reset code verified', { userId: user._id });
      return user;
    } catch (error) {
      Logger.error('Reset code verification failed:', error);
      throw error;
    }
  },

  // Reset Password (matches PDF "Set a password" flow)
  resetPassword: async (email: string, code: string, newPassword: string): Promise<void> => {
    try {
      // Verify the code first
      const user = await authService.verifyResetCode(email, code);

      user.password = newPassword;
      await user.save();

      // Remove the reset token
      await PasswordResetToken.deleteOne({ user: user._id, code });

      // Send password change confirmation
      await emailService.sendPasswordChangeConfirmation(user.email!, user.name);

      Logger.info('Password reset successful', { userId: user._id });
    } catch (error) {
      Logger.error('Password reset failed:', error);
      throw error;
    }
  },

  // Refresh Token
  refreshToken: async (
    oldToken: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
  }> => {
    try {
      const decoded = verifyRefreshToken(oldToken);
      const user = await User.findById(decoded.id);

      if (!user || !user.isVerified) {
        throw new Error('Invalid refresh token');
      }

      const accessToken = generateToken({
        id: user._id.toString(),
        role: user.role
      });
      const refreshToken = generateRefreshToken({
        id: user._id.toString()
      });

      Logger.info('Token refreshed', { userId: user._id });

      return { accessToken, refreshToken };
    } catch (error) {
      Logger.error('Token refresh failed:', error);
      throw new Error('Invalid or expired refresh token');
    }
  },

  // Get Current User
  getCurrentUser: async (userId: string): Promise<AuthResult['user']> => {
    try {
      const user = await User.findById(userId)
        .select('-password')
        .populate('children', 'name profile.age profile.gender')
        .populate('school', 'name');

      if (!user) {
        throw new Error('User not found');
      }

      return {
        id: user._id.toString(),
        email: user.email!,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
        children: user.role === 'parent' ? user.children : undefined,
        profile: user.profile,
        schoolName: user.profile?.schoolName
      };
    } catch (error) {
      Logger.error('Get current user failed:', error);
      throw error;
    }
  },

  // Legacy signup method (for backward compatibility)
  signup: async (payload: {
    name: string;
    email?: string;
    password?: string;
    phone?: string;
    role: IUser['role'];
    schoolId?: string;
    children?: { name: string; age?: number; gender?: string }[];
  }): Promise<IUser> => {
    try {
      // Convert to new format and use new registration system
      const newPayload: RegistrationInput = {
        name: payload.name,
        email: payload.email!,
        phone: payload.phone!,
        password: payload.password!,
        role: payload.role,
        children: payload.children?.map((child, index) => ({
          id: `legacy-${index}`,
          name: child.name,
          age: child.age || 5,
          gender: (child.gender as 'male' | 'female' | 'other') || 'other'
        })),
        termsAccepted: true, // Default for legacy
        marketingConsent: false
      };

      const result = await authService.registerUser(newPayload);
      return result.user;
    } catch (error) {
      Logger.error('Legacy signup failed:', error);
      throw error;
    }
  },

  // Logout
  logout: async (userId: string): Promise<void> => {
    try {
      // Here you can implement token blacklisting if using Redis
      // For now, just log the logout
      Logger.info('User logged out', { userId });
    } catch (error) {
      Logger.error('Logout failed:', error);
      throw error;
    }
  }
};
