/* eslint-disable no-console */
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import { performance } from 'perf_hooks';
import { User } from '../models/user.model';
import { TeacherProfileModel } from '../models/teacherProfile.model';
import { Course } from '../models/course.model';

/**
 * 🧩 Connection Setup
 */
const MONGO_URI = 'mongodb://127.0.0.1:27017/HelloK12LocalBackup';
mongoose.connect(MONGO_URI);
console.log('✅ Connected to MongoDB');

/**
 * 🧠 SEED FUNCTION
 */
async function seedData(total = 10000) {
  console.log(`🌱 Seeding ${total} teachers with full fields...`);

  const users: any[] = [];
  const profiles: any[] = [];
  const courses: any[] = [];

  const languages = ['en', 'es', 'fr', 'de', 'hi'];
  const ageGroups = ['1-5', '6-10', '11-15', '16-20', '21-30', '30+'];

  for (let i = 0; i < total; i++) {
    const userId = new mongoose.Types.ObjectId();

    users.push({
      _id: userId,
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: faker.internet.password(),
      role: 'teacher',
      phone: '+0123456789',
      status: 'active',
      isVerified: true,
      termsAccepted: true,
      marketingConsent: faker.datatype.boolean(),
      privacyPolicyAccepted: true,
      lastLogin: faker.date.recent({ days: 90 })
    });

    profiles.push({
      user: userId,
      location: {
        country: faker.location.country(),
        state: faker.location.state(),
        city: faker.location.city()
      },
      aboutYou: faker.lorem.sentences(2),
      teachingStyle: faker.lorem.sentence(),
      whyTeaching: faker.lorem.sentence(),
      teachingLanguages: faker.helpers.arrayElements(
        languages,
        faker.number.int({ min: 1, max: 3 })
      ),
      nativeLanguage: faker.helpers.arrayElement(languages),
      ageGroupTeach: faker.helpers.arrayElements(ageGroups, faker.number.int({ min: 1, max: 2 })),
      teachingSpecialties: faker.lorem.words(3),
      highestEducation: faker.helpers.arrayElement(['B.Ed', 'M.Ed', 'PhD', 'BA']),
      certification: faker.lorem.words(2),
      institution: faker.company.name(),
      graduationYear: faker.number.int({ min: 2000, max: 2022 }).toString(),
      awards: faker.lorem.words(2),
      additionalNotes: faker.lorem.words(3),
      timezone: faker.location.timeZone(),
      teachingMode: faker.helpers.arrayElement(['ONLINE', 'IN_PERSON']),
      travelFee: faker.commerce.price({ min: 5, max: 50 }),
      maxStudentsPerGroup: faker.number.int({ min: 1, max: 10 }).toString(),
      dateOfBirth: faker.date.birthdate({ min: 20, max: 60, mode: 'age' }),
      yearsOfExperience: faker.number.int({ min: 1, max: 25 }),
      travelRadius: faker.number.int({ min: 1, max: 30 })
    });

    const numCourses = faker.number.int({ min: 1, max: 3 });
    for (let j = 0; j < numCourses; j++) {
      courses.push({
        title: faker.lorem.words(3),
        description: faker.lorem.sentences(2),
        language: faker.helpers.arrayElement(languages),
        lessonType: faker.helpers.arrayElement(['1-on-1', 'group']),
        studentCapacity: faker.number.int({ min: 1, max: 10 }),
        mode: faker.helpers.arrayElement(['online', 'in-person']),
        price: faker.number.int({ min: 10, max: 300 }),
        currency: 'USD',
        ageGroups: faker.helpers.arrayElements(ageGroups, faker.number.int({ min: 1, max: 2 })),
        startDate: faker.date.future(),
        endDate: faker.date.future(),
        ownerType: 'teacher',
        ownerId: userId,
        status: 'active',
        isTrialAvailable: faker.datatype.boolean(),
        enrolledCount: faker.number.int({ min: 0, max: 10 }),
        teachers: [userId]
      });
    }
  }

  await User.insertMany(users);
  await TeacherProfileModel.insertMany(profiles);
  await Course.insertMany(courses);
  console.log(
    `✅ Inserted: ${users.length} Users, ${profiles.length} Profiles, ${courses.length} Courses`
  );
}

/**
 * 🧩 Test Population
 */
async function verifyPopulate() {
  const sample = await User.findOne({ role: 'teacher' })
    .populate('teacherProfile')
    .populate('courses')
    .lean();

  console.log('\n🧠 Sample Populated Teacher:');
  console.dir(sample, { depth: 4 });
}

/**
 * 🧹 Reset + Seed
 */
Promise.all([User.deleteMany({}), TeacherProfileModel.deleteMany({}), Course.deleteMany({})]);

const start = performance.now();
seedData(5000); // you can scale to 10_000
const end = performance.now();
console.log(`⏱️ Seeding Time: ${(end - start).toFixed(2)} ms`);

verifyPopulate();

mongoose.disconnect();
console.log('🏁 Done!');
