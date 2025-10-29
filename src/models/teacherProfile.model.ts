import mongoose, { Schema, InferSchemaType } from 'mongoose';

const LocationSchema = new Schema(
  {
    country: { type: String, default: '' },
    state: { type: String, default: '' },
    city: { type: String, default: '' }
  },
  { _id: false }
);

const TeacherProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    location: { type: LocationSchema, default: {} },
    aboutYou: { type: String, default: '' },
    teachingStyle: { type: String, default: '' },
    whyTeaching: { type: String, default: '' },

    teachingLanguages: { type: [String], default: [] },
    nativeLanguage: { type: String, default: '' },
    ageGroupTeach: { type: [String], default: [] },

    teachingSpecialties: { type: String, default: '' },

    highestEducation: { type: String, default: '' },
    certification: { type: String, default: '' },
    institution: { type: String, default: '' },
    graduationYear: { type: String, default: '' },

    certificates: [{ type: Schema.Types.ObjectId, ref: 'Attachment' }],

    awards: { type: String, default: '' },
    additionalNotes: { type: String, default: '' },

    timezone: { type: String, default: '' },
    teachingMode: { type: String, enum: ['ONLINE', 'IN_PERSON'], default: 'ONLINE' },
    travelFee: { type: String, default: '' },
    maxStudentsPerGroup: { type: String, default: '' },
    specialNotes: { type: String, default: '' },

    dateOfBirth: { type: Date },
    yearsOfExperience: { type: Number, default: 0 },
    travelRadius: { type: Number, default: 0 },
    highlights: [{ type: Schema.Types.ObjectId, ref: 'Attachment' }]
  },
  { timestamps: true }
);

TeacherProfileSchema.index({ user: 1 }, { unique: true });

export type TeacherProfileDoc = InferSchemaType<typeof TeacherProfileSchema> & { _id: string };
export const TeacherProfileModel = mongoose.model('TeacherProfile', TeacherProfileSchema);
