import { Types } from 'mongoose';
import { ParentProfileModel } from '../../models/parentProfile.model';
import { SchoolProfileModel } from '../../models/schoolProfile.model';
import { StudentProfileModel } from '../../models/studentProfile.model';
import { TeacherProfileModel } from '../../models/teacherProfile.model';
import { IUser } from '../../models/user.model';

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
    profileImage?: any;
    phone?: string;
  };
  accessToken?: string;
  refreshToken?: string;
  requiresEmailVerification?: boolean;
  requiresAdminApproval?: boolean;
}

export interface RegistrationResult {
  user: IUser;
  children?: IUser[];
  requiresEmailVerification: boolean;
  verificationEmailSent: boolean;
  message: string;
}

export type UpdateCurrentUserInput = {
  userId: string;
  authUserId: string;
  authRole: string; // kept for future admin override policies
  body: any;
};

export const allowedUserFields = ['name', 'email', 'phone'] as const;

export const pick = <T extends Record<string, any>>(obj: T, keys: readonly string[]) => {
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (obj?.[k] !== undefined) out[k] = obj[k];
  }
  return out;
};

// Optional: profile field allowlists (recommended in production)
// Keep minimal for your current payload; expand as needed.
const teacherProfileAllowed = [
  'location',
  'yearsOfExperience',
  'aboutYou',
  'teachingStyle',
  'whyTeaching',
  'teachingLanguages',
  'nativeLanguage',
  'ageGroupTeach',
  'teachingSpecialties',
  'highestEducation',
  'certification',
  'institution',
  'graduationYear',
  'certificates',
  'awards',
  'additionalNotes',
  'timezone',
  'teachingMode',
  'travelFee',
  'maxStudentsPerGroup',
  'specialNotes',
  'dateOfBirth',
  'travelRadius',
  'highlights',
  'intro'
] as const;

const studentProfileAllowed = ['address', 'languages', 'age', 'gender', 'grade'] as const;
const parentProfileAllowed = ['address'] as const;
const schoolProfileAllowed = [
  'schoolName',
  'schoolType',
  'website',
  'description',
  'teachersDisplayLink',
  'addresses',
  'address1',
  'address2'
] as const;

export const sanitizeProfile = (role: string, profile: any) => {
  if (!profile || typeof profile !== 'object') return null;

  if (role === 'teacher') {
    const out = pick(profile, teacherProfileAllowed);

    if (out.highlights) {
      out.highlights = normalizeObjectIds(out.highlights);
    }

    if (out.intro) {
      const introId = typeof out.intro === 'string' ? out.intro : out.intro?._id || out.intro?.id;

      out.intro = Types.ObjectId.isValid(introId) ? new Types.ObjectId(introId) : null;
    }

    return out;
  }

  if (role === 'student') return pick(profile, studentProfileAllowed);
  if (role === 'parent') return pick(profile, parentProfileAllowed);
  if (role === 'school') return pick(profile, schoolProfileAllowed);

  return null;
};

export const profileModels: Record<string, any> = {
  student: StudentProfileModel,
  parent: ParentProfileModel,
  teacher: TeacherProfileModel,
  school: SchoolProfileModel
};

export const populateByRole = (role: string) => {
  if (role === 'parent') {
    return {
      path: 'parentProfile',
      populate: {
        path: 'children',
        populate: { path: 'studentProfile' }
      }
    };
  }

  if (role === 'teacher') {
    return {
      path: 'teacherProfile',
      populate: [
        {
          path: 'certificates',
          model: 'Attachment',
          match: { status: 'READY' },
          select: 'url key name size createdAt updatedAt mime'
        },
        {
          path: 'highlights',
          model: 'Attachment',
          match: { status: 'READY' },
          select: 'url key name size createdAt updatedAt mime isIntro'
        },
        {
          path: 'intro',
          model: 'Attachment',
          match: { status: 'READY' },
          select: 'url key name size createdAt updatedAt mime'
        }
      ]
    };
  }

  return { path: `${role}Profile` };
};

export const normalizeObjectIds = (arr: any[]): Types.ObjectId[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(v => {
      if (typeof v === 'string' && Types.ObjectId.isValid(v)) {
        return new Types.ObjectId(v);
      }
      if (v?._id && Types.ObjectId.isValid(v._id)) {
        return new Types.ObjectId(v._id);
      }
      if (v?.id && Types.ObjectId.isValid(v.id)) {
        return new Types.ObjectId(v.id);
      }
      return null;
    })
    .filter(Boolean) as Types.ObjectId[];
};
