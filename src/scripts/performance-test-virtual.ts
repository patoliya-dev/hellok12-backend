/* eslint-disable no-console */
import mongoose from 'mongoose';
import { performance } from 'perf_hooks';
import { User } from '../models/user.model';
import { TeacherProfileModel } from '../models/teacherProfile.model';
import { Course } from '../models/course.model';
import { FindTeacherService } from '../modules/find-teacher/findTeacher.service';
import { AttachmentModel } from '../models/attachment.model';

// 🧩 Connect to your test or local MongoDB
const MONGO_URI = 'mongodb://127.0.0.1:27017/HelloK12LocalVirtuals';

async function seedDataIfNeeded() {
  const existingCount = await User.countDocuments({ role: 'teacher' });
  if (existingCount >= 10000) {
    console.log(`✅ Already have ${existingCount} teachers, skipping seeding.`);
    return;
  }

  console.log('🌱 Seeding 10,000 teachers...');
  const bulkUsers = [];
  const bulkProfiles = [];
  const bulkCourses = [];

  for (let i = 0; i < 10000; i++) {
    const teacherId = new mongoose.Types.ObjectId();
    bulkUsers.push({
      insertOne: {
        document: {
          _id: teacherId,
          name: `Teacher ${i}`,
          email: `teacher${i}@mail.com`,
          password: 'hashedpw',
          role: 'teacher',
          isVerified: true,
          termsAccepted: true,
          status: 'active',
          profile: {
            experience: Math.floor(Math.random() * 15),
            languages: ['en', 'fr', 'es'].slice(0, Math.floor(Math.random() * 3) + 1),
            averageRating: Math.random() * 5,
            totalLessons: Math.floor(Math.random() * 500)
          }
        }
      }
    });

    bulkProfiles.push({
      insertOne: {
        document: {
          user: teacherId,
          teachingLanguages: ['en', 'fr', 'es'].slice(0, Math.floor(Math.random() * 3) + 1),
          yearsOfExperience: Math.floor(Math.random() * 15),
          ageGroupTeach: ['0-5', '6-12', '13-18'].slice(0, Math.floor(Math.random() * 3) + 1),
          teachingMode: Math.random() > 0.5 ? 'ONLINE' : 'IN_PERSON'
        }
      }
    });

    bulkCourses.push({
      insertOne: {
        document: {
          title: `Course ${i}`,
          language: 'en',
          lessonType: '1-on-1',
          studentCapacity: 1,
          mode: 'online',
          price: Math.floor(Math.random() * 1000),
          currency: 'USD',
          ageGroups: ['3-5'],
          startDate: new Date(),
          ownerType: 'teacher',
          ownerId: teacherId,
          status: 'active',
          isTrialAvailable: false,
          teachers: [teacherId]
        }
      }
    });
  }
  const bulkAttachments: any[] = []; // Empty for now, but can add if needed

  await User.bulkWrite(bulkUsers);
  await TeacherProfileModel.bulkWrite(bulkProfiles);
  await Course.bulkWrite(bulkCourses);
  await AttachmentModel.bulkWrite(bulkAttachments);
  console.log('✅ Seeding complete.');
}

async function runBenchmark() {
  const testFilters = [
    // 🎓 Experience-based filters
    { experience: '0-2' },
    { experience: '3-5' },
    { experience: '6-10' },
    { experience: '10-15' },

    // 💬 Language-based filters
    { languages: 'en' },
    { languages: 'fr' },
    { languages: 'es' },
    { languages: 'hi' },
    { languages: 'de' },

    // ⭐ Ratings
    { ratings: 3 },
    { ratings: 4 },
    { ratings: 4.5 },

    // 🧒 Age groups
    { ageRange: ['kids'] },
    { ageRange: ['teens'] },
    { ageRange: ['adults'] },

    // 💰 Price-based
    { price: [0, 100] },
    { price: [100, 500] },
    { price: [500, 1000] },
    { price: [1000, 2000] },

    // 🏫 School-based (use valid school IDs if available)
    { school: '672aab0c2f884e9d1fbc1234' }, // replace with real ObjectId from your DB

    // ⚙️ Mixed filters (realistic search cases)
    { languages: 'en', experience: '5-10', ratings: 4 },
    { languages: 'fr', price: [100, 800], ageRange: ['teens'] },
    { experience: '2-5', price: [200, 600], ratings: 3.5 },
    { languages: 'es', ageRange: ['kids'], ratings: 4.2 },
    { experience: '10-15', price: [1000, 1500], ratings: 4.5 },
    { languages: 'hi', experience: '0-3', price: [50, 300], ratings: 2.5 },
    { languages: 'de', experience: '8-12', price: [400, 900], ratings: 4 },

    // 🧪 Edge case: no filters (baseline performance)
    {}
  ];

  const results: number[] = [];

  console.log('🚀 Running find-teacher benchmark...');
  for (const filters of testFilters) {
    const pagination = { offset: 0, limit: 10 };

    const start = performance.now();
    await FindTeacherService.list(filters, pagination);
    const end = performance.now();

    const timeTaken = end - start;
    results.push(timeTaken);
    console.log(`⏱️ Filters: ${JSON.stringify(filters)} => ${timeTaken.toFixed(2)} ms`);
  }

  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  console.log(`\n📊 Benchmark Summary:`);
  console.log(`Min: ${Math.min(...results).toFixed(2)} ms`);
  console.log(`Max: ${Math.max(...results).toFixed(2)} ms`);
  console.log(`Avg: ${avg.toFixed(2)} ms`);
}

export async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('🔗 Connected to DB');

  await seedDataIfNeeded();

  await runBenchmark();

  await mongoose.disconnect();
  console.log('🔌 Disconnected');
}

main().catch(err => {
  console.error('❌ Benchmark failed:', err);
  process.exit(1);
});
