import { Schema, model, Types, Document } from 'mongoose';

export type UserRole = 'student' | 'parent' | 'teacher' | 'school';

export interface IUserProfile {
  [key: string]: string | number | boolean | Date | object | IUserProfile[];
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  email?: string;
  password?: string;
  name: string;
  role: UserRole;
  phone?: string;
  school?: Types.ObjectId;
  parent?: Types.ObjectId;
  children?: Types.ObjectId[];
  isVerified: boolean;
  profile?: IUserProfile;
  termsAccepted: boolean;
  marketingConsent?: boolean;
}

// Conditional required fields for student without parent
const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      lowercase: true,
      unique: true,
      sparse: true, // important for allowing multiple nulls
      required: function () {
        // Email is required only if user is student without parent OR independent roles (teacher, school)
        return (this.role === 'student' && !this.parent) || ['teacher', 'school'].includes(this.role);
      },
    },
    password: {
      type: String,
      required: function () {
        // Password required only if user is student without parent OR independent roles
        return (this.role === 'student' && !this.parent) || ['teacher', 'school'].includes(this.role);
      },
    },
    name: { type: String, required: true },
    role: { type: String, enum: ['student', 'parent', 'teacher', 'school'], required: true },
    phone: { type: String },
    school: { type: Schema.Types.ObjectId, ref: 'User' },
    parent: { type: Schema.Types.ObjectId, ref: 'User' },
    children: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isVerified: { type: Boolean, default: false },
    profile: { type: Schema.Types.Mixed, default: {} },
    termsAccepted: { type: Boolean, default: false },
    marketingConsent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);
