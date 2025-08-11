import { ObjectId } from 'mongoose';

export interface IUser {
  _id: ObjectId;
  role: 'PARENT' | 'STUDENT';
  email: string;
  phone?: string;
  password: string;
  name: string;
  profilePicture?: string;
  language: string;
  address: string;
  createdAt: Date;
  updatedAt: Date;
}
