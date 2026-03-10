import { Schema, model, Types, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Logger from '../utils/winstonLogger.utils';

export type UserRole = 'student' | 'parent' | 'teacher' | 'school' | 'super_admin';

export interface IUserProfile {
  // Student-specific fields
  age?: number;
  grade?: string;
  gender?: 'male' | 'female' | 'other';
  childIndex?: number; // For parent-created children (Child 1, Child 2, etc.)

  // Teacher-specific fields
  bio?: string;
  experience?: number;
  languages?: string[];
  hourlyRate?: number;
  employmentType?: 'independent' | 'school_employee';
  teachingMethods?: string[];
  availability?: Array<{
    day: string;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }>;
  specializations?: string[];

  // School-specific fields
  schoolName?: string;
  schoolType?: string;
  establishedYear?: number;
  website?: string;
  description?: string;

  // Address information
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;

  // System tracking
  registrationSource?: string;
  onboardingCompleted?: boolean;
  profileCompleted?: boolean;
  status?: 'pending' | 'active' | 'suspended' | 'inactive' | 'pending_approval';

  // Statistics (from the dashboard views in your UI)
  totalLessons?: number;
  completedLessons?: number;
  averageRating?: number;
  totalRatings?: number;
  totalEarnings?: number;

  // Additional metadata
  lastLoginAt?: Date;
  emailVerifiedAt?: Date;

  [key: string]: string | number | boolean | Date | object | IUserProfile[] | undefined;
}

export interface IUser extends Document {
  _id: Types.ObjectId;

  // Basic Information
  email?: string;
  password?: string;
  name: string;
  role: UserRole;
  phone?: string;

  // Relationships
  school?: Types.ObjectId; // Reference to school (for teachers/students)
  parent?: Types.ObjectId; // Reference to parent (for students)
  children?: Types.ObjectId[]; // References to children (for parents)
  admin?: Types.ObjectId; // Reference to admin (for teachers/students/school)

  // Authentication & Verification
  isVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  refreshToken?: string;
  lastLogin?: Date;

  // Legal & Preferences
  termsAccepted: boolean;
  termsAcceptedAt?: Date;
  marketingConsent?: boolean;
  privacyPolicyAccepted?: boolean;

  // Extended Profile
  profile?: IUserProfile;

  // Status Management
  status?: 'pending' | 'active' | 'suspended' | 'inactive';
  suspendedAt?: Date;
  suspensionReason?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;

  // Stripe / Payments
  stripeCustomerId?: string;
  stripeAccountId?: string;
  stripeOnboardingComplete?: boolean;

  availabilityStatus?: 'online' | 'offline';
  lastSeen?: Date;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Instance Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateEmailVerificationToken(): string;
  generatePasswordResetToken(): string;
  getPublicProfile(): Partial<IUser>;
  getDashboardData(): any;
}

// Enhanced User Schema
const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      lowercase: true,
      unique: true,
      sparse: true,
      trim: true,
      required: function (this: IUser) {
        // Email is required for independent users (not parent-created children)
        return (
          (this.role === 'student' && !this.parent) ||
          ['parent', 'teacher', 'school', 'super_admin'].includes(this.role)
        );
      },
      validate: {
        validator: function (v: string) {
          return !v || /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
        },
        message: 'Please enter a valid email address'
      }
    },

    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      required: function (this: IUser) {
        // Password required for independent users (not parent-created children)
        return (
          (this.role === 'student' && !this.parent) ||
          ['parent', 'teacher', 'school', 'super_admin'].includes(this.role)
        );
      }
    },

    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },

    role: {
      type: String,
      enum: {
        values: ['student', 'parent', 'teacher', 'school', 'super_admin'],
        message: 'Role must be one of: student, parent, teacher, school, super_admin'
      },
      required: [true, 'Role is required']
    },

    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v: string) {
          return !v || /^\+?[1-9]\d{0,15}$/.test(v);
        },
        message: 'Please enter a valid phone number'
      }
    },

    // Relationships
    school: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Reference to school user
      validate: {
        validator: async function (v: Types.ObjectId) {
          if (!v) return true;
          const school = await model('User').findById(v);
          return school && school.role === 'school';
        },
        message: 'Referenced school must exist and have school role'
      }
    },

    admin: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Reference to school user
      validate: {
        validator: async function (v: Types.ObjectId) {
          if (!v) return true;
          const admin = await model('User').findById(v);
          return admin && admin.role === 'super_admin';
        },
        message: 'Referenced super_admin must exist and have super_admin role'
      }
    },

    parent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      validate: {
        validator: async function (v: Types.ObjectId) {
          if (!v) return true;
          const parent = await model('User').findById(v);
          return parent && parent.role === 'parent';
        },
        message: 'Referenced parent must exist and have parent role'
      }
    },

    // Authentication fields
    isVerified: {
      type: Boolean,
      default: false
    },

    emailVerificationToken: {
      type: String,
      select: false // Don't include in queries by default
    },

    emailVerificationExpires: {
      type: Date,
      select: false
    },

    passwordResetToken: {
      type: String,
      select: false
    },

    passwordResetExpires: {
      type: Date,
      select: false
    },

    refreshToken: {
      type: String,
      select: false
    },

    lastLogin: Date,

    // Legal & Preferences
    termsAccepted: {
      type: Boolean,
      default: false,
      required: [true, 'Terms acceptance is required']
    },

    termsAcceptedAt: Date,

    marketingConsent: {
      type: Boolean,
      default: false
    },

    privacyPolicyAccepted: {
      type: Boolean,
      default: true
    },

    // Status Management
    status: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'inactive'],
      default: function (this: IUser) {
        // Parent-created children are active by default
        return this.role === 'student' && this.parent ? 'active' : 'pending';
      }
    },
    stripeCustomerId: { type: String, default: null },
    stripeAccountId: { type: String, default: null }, // connected account id for teachers
    stripeOnboardingComplete: { type: Boolean, default: false },

    suspendedAt: Date,
    suspensionReason: String,
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,

    availabilityStatus: {
      type: String,
      enum: ['online', 'offline'],
      default: 'offline'
    },

    lastSeen: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // Remove sensitive fields from JSON output
        delete ret.password;
        delete ret.emailVerificationToken;
        delete ret.passwordResetToken;
        delete ret.refreshToken;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// Indexes for better performance
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ parent: 1 });
UserSchema.index({ school: 1 });
UserSchema.index({ role: 1, school: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ lastLogin: -1 });
UserSchema.index({ name: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ role: 1, isVerified: 1, status: 1 });
UserSchema.index({ role: 1, school: 1, status: 1, isVerified: 1 });

// Text search index for name and email
UserSchema.index({
  name: 'text',
  email: 'text'
});

// Virtual fields
UserSchema.virtual('fullName').get(function (this: IUser) {
  return this.name;
});

UserSchema.virtual('isActive').get(function (this: IUser) {
  return this.status === 'active' && this.isVerified;
});

UserSchema.virtual('dashboardUrl').get(function (this: IUser) {
  const dashboardUrls = {
    student: '/student/dashboard',
    parent: '/parent/dashboard',
    teacher: '/teacher/dashboard',
    school: '/school/dashboard',
    super_admin: '/admin/dashboard'
  };
  return dashboardUrls[this.role] || '/dashboard';
});

UserSchema.virtual('studentProfile', {
  ref: 'StudentProfile',
  localField: '_id',
  foreignField: 'user',
  justOne: true
});

UserSchema.virtual('parentProfile', {
  ref: 'ParentProfile',
  localField: '_id',
  foreignField: 'user',
  justOne: true
});

UserSchema.virtual('teacherProfile', {
  ref: 'TeacherProfile',
  localField: '_id',
  foreignField: 'user',
  justOne: true
});

UserSchema.virtual('schoolProfile', {
  ref: 'SchoolProfile',
  localField: '_id',
  foreignField: 'user',
  justOne: true
});

UserSchema.virtual('profileImage', {
  ref: 'Attachment',
  localField: '_id',
  foreignField: 'entityId',
  justOne: true,
  match: { entityType: 'User', status: 'READY' }
});

UserSchema.virtual('courses', {
  ref: 'Course',
  localField: '_id',
  foreignField: 'teachers',
  justOne: false
});

// Pre-save middleware
UserSchema.pre('save', async function (next) {
  // Hash password if modified
  if (this.isModified('password') && this.password) {
    try {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error as Error);
    }
  }

  // Set termsAcceptedAt when terms are accepted
  if (this.isModified('termsAccepted') && this.termsAccepted && !this.termsAcceptedAt) {
    this.termsAcceptedAt = new Date();
  }

  // Auto-verify parent-created children
  if (this.isNew && this.role === 'student' && this.parent && !this.isVerified) {
    this.isVerified = true;
    this.status = 'active';
  }

  if (this.isModified('availabilityStatus') && this.availabilityStatus === 'offline') {
    this.lastSeen = new Date();
  }

  next();
});

// Post-save middleware
UserSchema.post('save', async function (doc) {
  // Update parent's children array when child is created
  if (doc.isNew && doc.parent && doc.role === 'student') {
    try {
      await model('User').findByIdAndUpdate(
        doc.parent,
        { $addToSet: { children: doc._id } },
        { new: true }
      );
    } catch (error) {
      Logger.error('Error updating parent children array:', error);
    }
  }
});

// Instance Methods
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.generateEmailVerificationToken = function (): string {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  return token;
};

UserSchema.methods.generatePasswordResetToken = function (): string {
  const token = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  return token;
};

UserSchema.methods.getPublicProfile = function (): Partial<IUser> {
  return {
    _id: this._id,
    name: this.name,
    role: this.role,
    profile: {
      bio: this.profile?.bio,
      experience: this.profile?.experience,
      languages: this.profile?.languages,
      specializations: this.profile?.specializations,
      averageRating: this.profile?.averageRating,
      totalLessons: this.profile?.totalLessons
    },
    createdAt: this.createdAt
  };
};

UserSchema.methods.setOnlineStatus = async function (status: 'online' | 'offline') {
  this.availabilityStatus = status;
  if (status === 'offline') {
    this.lastSeen = new Date();
  }
  await this.save();
};

UserSchema.methods.getDashboardData = function (): any {
  const baseData = {
    id: this._id,
    name: this.name,
    role: this.role,
    isVerified: this.isVerified,
    profile: this.profile,
    lastLogin: this.lastLogin
  };

  // Add role-specific dashboard data
  switch (this.role) {
    case 'parent':
      return {
        ...baseData,
        children: this.children,
        totalChildren: this.children?.length || 0
      };

    case 'teacher':
      return {
        ...baseData,
        totalLessons: this.profile?.totalLessons || 0,
        averageRating: this.profile?.averageRating || 0,
        totalEarnings: this.profile?.totalEarnings || 0,
        languages: this.profile?.languages || []
      };

    case 'school':
      return {
        ...baseData,
        schoolName: this.profile?.schoolName,
        totalTeachers: this.profile?.totalTeachers || 0,
        totalStudents: this.profile?.totalStudents || 0,
        monthlyRevenue: this.profile?.monthlyRevenue || 0
      };

    default:
      return baseData;
  }
};

// Static Methods
UserSchema.statics.findByEmail = function (email: string) {
  return this.findOne({ email: email.toLowerCase() });
};

UserSchema.statics.findActiveUsers = function (role?: UserRole) {
  const filter: any = { status: 'active', isVerified: true };
  if (role) filter.role = role;
  return this.find(filter);
};

UserSchema.statics.getRegistrationStats = function () {
  return this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        verified: { $sum: { $cond: ['$isVerified', 1, 0] } },
        active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
      }
    }
  ]);
};

export const User = model<IUser>('User', UserSchema);
