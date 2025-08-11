import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: 'super_admin' | 'school' | 'teacher' | 'parent' | 'student';
  isVerified: boolean;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'school', 'teacher', 'parent', 'student'],
      required: true,
    },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default model<IUser>('User', userSchema);
