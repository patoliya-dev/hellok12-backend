import { User, IUser } from '../models/user.model';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { randomInt } from 'crypto';
import { sendVerificationEmail, sendVerificationCode } from './email.service';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.util';
import { PasswordResetToken } from '../models/passwordResetToken.model';

export const authService = {
  signup: async (
    payload: {
      name: string;
      email?: string;
      password?: string;
      phone?: string;
      role: IUser['role'];
      schoolId?: string;
      children?: { name: string; age?: number; gender?: string }[];
    }
  ): Promise<IUser> => {
    const { name, email, password, role, phone, schoolId, children } = payload;

    // Email unique check only if email exists
    if (email) {
      const existing = await User.findOne({ email });
      if (existing) throw new Error('Email already in use');
    }

    const hashedPassword = password ? await bcrypt.hash(password, 12) : '';

    const userData: Partial<IUser> = {
      name,
      email,
      password: hashedPassword,
      role,
      phone,
      isVerified: false,
      school: schoolId ? new Types.ObjectId(schoolId) : undefined,
    };

    const user = new User(userData);
    await user.save();

    // Parent + Children creation
    if (role === 'parent' && Array.isArray(children) && children.length > 0) {
      const childIds: Types.ObjectId[] = [];

      for (const child of children) {
        const childUser = new User({
          name: child.name,
          role: 'student',
          parent: user._id,
          isVerified: false,
          profile: { age: child.age, gender: child.gender },
        });

        await childUser.save();
        childIds.push(childUser._id);
      }

      user.children = childIds;
      await user.save();

      // Send **only one email to parent** for verification of all children
      if (user.email && childIds.length > 0) {
        const token = generateRefreshToken({ id: user._id.toString(), action: 'verify' });

        await sendVerificationEmail(user.email, token);
      }
    }

    // Send verification email for the parent (if they have email)
    if (user.email && role !== 'parent') {
      const token = generateRefreshToken({ id: user._id.toString(), action: 'verify' });
      await sendVerificationEmail(user.email, token);
    }

    return user;
  },

  login: async (email: string, password: string): Promise<{ accessToken: string; refreshToken: string, user: IUser }> => {
    const user = await User.findOne({ email });
    if (!user) throw new Error('Invalid credentials');
    if (!user.isVerified) throw new Error('Email not verified');

    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) throw new Error('Invalid credentials');

    const accessToken = generateToken({ id: user._id.toString(), role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id.toString() });

    return { accessToken, refreshToken, user };
  },

  verifyEmail: async (token: string): Promise<IUser> => {
    const decoded = verifyRefreshToken(token);
    if (decoded.action !== 'verify') throw new Error('Invalid token');

    const user = await User.findById(decoded.id);
    if (!user) throw new Error('User not found');

    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    return user;
  },

  forgotPassword: async (email: string): Promise<void> => {
    const user = await User.findOne({ email });
    if (!user) throw new Error('User not found');

    const code = randomInt(100000, 999999).toString();

    const expiryMinutes = new Date(Date.now() + 15 * 60 * 1000);
    await PasswordResetToken.create({
      user: user._id,
      code,
      expiresAt: expiryMinutes, // 15 mins expiry
    });

    await sendVerificationCode({
      email,
      name: user.name,
      code,
      expiryMinutes: 15,
    });
  },

  verifyResetCode: async (email: string, code: string): Promise<IUser> => {
    const tokenDoc = await PasswordResetToken.findOne({ code }).populate<{ user: IUser }>('user');

    if (!tokenDoc || !tokenDoc.user || tokenDoc.user.email !== email) {
      throw new Error('Invalid verification code');
    }

    if (new Date() > tokenDoc.expiresAt) {
      throw new Error('Verification code expired');
    }

    return tokenDoc.user;
  },

  resetPassword: async (email: string, code: string, newPassword: string): Promise<void> => {
    const user = await authService.verifyResetCode(email, code);

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    // Remove the token after successful reset
    await PasswordResetToken.deleteOne({ code, user: user._id });
  },

  refreshToken: async (oldToken: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const decoded = verifyRefreshToken(oldToken);
    const user = await User.findById(decoded.id);
    if (!user) throw new Error('User not found');

    const accessToken = generateToken({ id: user._id.toString(), role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id.toString() });

    return { accessToken, refreshToken };
  },
};
