// models/Vocabulary.ts
import { Schema, model, Document, Types } from 'mongoose';

export interface IVocabulary extends Document {
  lesson: Types.ObjectId;
  word: string;
  image?: string;
}

const VocabularySchema = new Schema<IVocabulary>(
  {
    lesson: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    word: { type: String, required: true },
    image: { type: String }
  },
  { timestamps: true }
);

export const Vocabulary = model<IVocabulary>('Vocabulary', VocabularySchema);
