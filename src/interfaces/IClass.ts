import { ObjectId } from 'mongoose';

export interface IClass {
  _id: ObjectId;
  teacherId: ObjectId;
  title: string;
  description: string;
  durationMinutes: number;
  type: 'GROUP' | 'ONE_ON_ONE';
  mode: 'ONLINE' | 'IN_PERSON';
  price: number;
  schedule: {
    days: string[];
    time: string;
    location?: string;
  };
  studentLimit: number;
  enrolledStudentIds: ObjectId[];
  isTrial: boolean;
  nextSessionDate: Date;
  language: string;
  topics: string[];
}
