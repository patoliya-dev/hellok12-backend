import { faker } from '@faker-js/faker';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcryptjs';

// Configuration
const TOTAL_USERS = 10000;
const ROLE_DISTRIBUTION = {
  teacher: 0.3, // 30% teachers (3000)
  student: 0.5, // 50% students (5000)
  parent: 0.15, // 15% parents (1500)
  school: 0.05 // 5% schools (500)
};

const COURSES_PER_TEACHER = { min: 2, max: 8 };
const RATINGS_PER_TEACHER = { min: 5, max: 50 };
const AGE_GROUPS = ['0-2', '3-5', '6-8', '9-11', '12-14', '15-17', '18+'];
const LANGUAGES = ['en', 'sp', 'fr', 'ge', 'ma', 'ja', 'ar', 'hi'];
const TEACHING_MODES = ['ONLINE', 'IN_PERSON'];
const LESSON_TYPES = ['1-on-1', 'group'];
const COURSE_MODES = ['online', 'in-person'];

// Helper functions
const randomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomElements = <T>(arr: T[], min: number, max: number): T[] => {
  const count = faker.number.int({ min, max });
  return faker.helpers.shuffle(arr).slice(0, count);
};
const randomBool = (probability = 0.5) => Math.random() < probability;

// Generate User Data
function generateUser(role: string, schoolId?: Types.ObjectId, parentId?: Types.ObjectId) {
  const isChildStudent = role === 'student' && parentId;
  const needsAuth = !isChildStudent;

  const user: any = {
    _id: new Types.ObjectId(),
    name: faker.person.fullName(),
    role,
    phone: randomBool(0.8) ? faker.phone.number({ style: 'human' }) : undefined,
    isVerified: randomBool(0.7),
    termsAccepted: true,
    termsAcceptedAt: faker.date.past({ years: 2 }),
    marketingConsent: randomBool(0.4),
    privacyPolicyAccepted: true,
    status: isChildStudent
      ? 'active'
      : randomElement(['pending', 'active', 'suspended', 'inactive']),
    lastLogin: randomBool(0.8) ? faker.date.recent({ days: 30 }) : undefined,
    createdAt: faker.date.past({ years: 3 }),
    updatedAt: faker.date.recent({ days: 90 })
  };

  // Email and password for non-child students
  if (needsAuth) {
    user.email = faker.internet.email().toLowerCase();
    user.password = bcrypt.hashSync('password123', 10); // Default password
  }

  // School assignment
  if (role === 'teacher' || role === 'student') {
    user.school = schoolId;
  }

  // Parent assignment for child students
  if (isChildStudent) {
    user.parent = parentId;
  }

  // Suspension details
  if (user.status === 'suspended') {
    user.suspendedAt = faker.date.recent({ days: 60 });
    user.suspensionReason = faker.helpers.arrayElement([
      'Violation of terms',
      'Inappropriate behavior',
      'Payment issues',
      'Under investigation'
    ]);
  }

  // Approval details for active users
  if (user.status === 'active' && randomBool(0.8)) {
    user.approvedAt = faker.date.between({
      from: user.createdAt,
      to: new Date()
    });
  }

  return user;
}

// Generate Teacher Profile
function generateTeacherProfile(userId: Types.ObjectId) {
  const profile: any = {
    _id: new Types.ObjectId(),
    user: userId,
    location: {
      country: faker.location.country(),
      state: faker.location.state(),
      city: faker.location.city()
    },
    aboutYou: faker.lorem.paragraphs(2),
    teachingStyle: faker.lorem.paragraph(),
    whyTeaching: faker.lorem.paragraph(),
    teachingLanguages: randomElements(LANGUAGES, 1, 3),
    nativeLanguage: randomElement(LANGUAGES),
    ageGroupTeach: randomElements(AGE_GROUPS, 1, 4),

    teachingSpecialties: faker.helpers
      .arrayElements(
        [
          'Mathematics',
          'Science',
          'Languages',
          'Arts',
          'Music',
          'Sports',
          'Technology',
          'Literature'
        ],
        faker.number.int({ min: 1, max: 4 })
      )
      .join(', '),

    highestEducation: randomElement([
      'High School Diploma',
      "Bachelor's Degree",
      "Master's Degree",
      'PhD',
      'Professional Certificate'
    ]),
    certification: randomBool(0.7)
      ? faker.helpers.arrayElement([
          'TEFL Certified',
          'State Teaching License',
          'Montessori Certified',
          'Special Education Certified'
        ])
      : '',
    institution: faker.company.name() + ' University',
    graduationYear: faker.date.past({ years: 20 }).getFullYear().toString(),

    awards: randomBool(0.4) ? faker.lorem.sentence() : '',
    additionalNotes: randomBool(0.6) ? faker.lorem.paragraph() : '',

    timezone: faker.location.timeZone(),
    teachingMode: randomElement(TEACHING_MODES),
    travelFee: randomBool(0.5) ? `$${faker.number.int({ min: 10, max: 100 })}` : '',
    maxStudentsPerGroup: faker.number.int({ min: 1, max: 15 }).toString(),
    specialNotes: randomBool(0.5) ? faker.lorem.sentence() : '',

    dateOfBirth: faker.date.birthdate({ min: 22, max: 65, mode: 'age' }),
    yearsOfExperience: faker.number.int({ min: 0, max: 30 }),
    travelRadius: faker.number.int({ min: 0, max: 50 }),

    createdAt: faker.date.past({ years: 2 }),
    updatedAt: faker.date.recent({ days: 60 })
  };

  return profile;
}

// Generate Course
function generateCourse(teacherId: Types.ObjectId, ownerType: string, ownerId: Types.ObjectId) {
  const startDate = faker.date.between({
    from: new Date(),
    to: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
  });

  const course: any = {
    _id: new Types.ObjectId(),
    title: faker.company.catchPhrase(),
    description: faker.lorem.paragraphs(3),
    language: randomElement(LANGUAGES),
    lessonType: randomElement(LESSON_TYPES),
    studentCapacity: faker.number.int({ min: 1, max: 20 }),
    mode: randomElement(COURSE_MODES),
    price: faker.number.int({ min: 10, max: 500 }),
    currency: 'USD',
    ageGroups: randomElements(AGE_GROUPS, 1, 3),

    startDate,
    endDate: randomBool(0.7) ? faker.date.future({ years: 1, refDate: startDate }) : undefined,

    ownerType,
    ownerId,

    status: randomElement(['draft', 'active', 'active', 'active', 'archived']), // More active courses
    isTrialAvailable: randomBool(0.3),

    enrolledCount: faker.number.int({ min: 0, max: 50 }),
    teachers: [teacherId],

    createdAt: faker.date.past({ years: 2 }),
    updatedAt: faker.date.recent({ days: 30 })
  };

  return course;
}

// Generate Rating
function generateRating(
  teacherId: Types.ObjectId,
  courseId: Types.ObjectId,
  studentId: Types.ObjectId
) {
  const rating: any = {
    _id: new Types.ObjectId(),
    lesson: new Types.ObjectId(), // Mock lesson ID
    course: courseId,
    author: studentId,
    teacher: teacherId,
    rating: faker.number.int({ min: 1, max: 5 }),
    comment: faker.lorem.paragraph(),
    createdAt: faker.date.past({ years: 1 }),
    updatedAt: faker.date.recent({ days: 30 })
  };

  return rating;
}

// Main seeding function
async function seedDatabase() {
  console.log('🌱 Starting database seeding...\n');

  const users: any[] = [];
  const teacherProfiles: any[] = [];
  const courses: any[] = [];
  const ratings: any[] = [];

  // Calculate role counts
  const roleCounts = {
    school: Math.floor(TOTAL_USERS * ROLE_DISTRIBUTION.school),
    teacher: Math.floor(TOTAL_USERS * ROLE_DISTRIBUTION.teacher),
    parent: Math.floor(TOTAL_USERS * ROLE_DISTRIBUTION.parent),
    student: 0 // Will be calculated
  };
  roleCounts.student = TOTAL_USERS - roleCounts.school - roleCounts.teacher - roleCounts.parent;

  console.log('📊 Role Distribution:');
  console.log(`   Schools: ${roleCounts.school}`);
  console.log(`   Teachers: ${roleCounts.teacher}`);
  console.log(`   Parents: ${roleCounts.parent}`);
  console.log(`   Students: ${roleCounts.student}\n`);

  // Step 1: Generate Schools
  console.log('🏫 Generating schools...');
  const schools: Types.ObjectId[] = [];
  for (let i = 0; i < roleCounts.school; i++) {
    const school = generateUser('school');
    users.push(school);
    schools.push(school._id);
  }

  // Step 2: Generate Teachers
  console.log('👨‍🏫 Generating teachers and profiles...');
  const teachers: Types.ObjectId[] = [];
  for (let i = 0; i < roleCounts.teacher; i++) {
    const schoolId = randomBool(0.8) ? randomElement(schools) : undefined;
    const teacher = generateUser('teacher', schoolId);
    users.push(teacher);
    teachers.push(teacher._id);

    // Generate teacher profile
    const profile = generateTeacherProfile(teacher._id);
    teacherProfiles.push(profile);
  }

  // Step 3: Generate Parents
  console.log('👪 Generating parents...');
  const parents: Types.ObjectId[] = [];
  for (let i = 0; i < roleCounts.parent; i++) {
    const parent = generateUser('parent');
    users.push(parent);
    parents.push(parent._id);
  }

  // Step 4: Generate Students
  console.log('🎓 Generating students...');
  const students: Types.ObjectId[] = [];
  for (let i = 0; i < roleCounts.student; i++) {
    // 40% are children created by parents
    const parentId = randomBool(0.4) ? randomElement(parents) : undefined;
    const schoolId = randomBool(0.7) ? randomElement(schools) : undefined;
    const student = generateUser('student', schoolId, parentId);
    users.push(student);
    students.push(student._id);
  }

  // Step 5: Generate Courses
  console.log('📚 Generating courses...');
  teachers.forEach(teacherId => {
    const numCourses = faker.number.int(COURSES_PER_TEACHER);
    const teacherUser = users.find(u => u._id.equals(teacherId));
    const ownerType = teacherUser?.school && randomBool(0.5) ? 'school' : 'teacher';
    const ownerId = ownerType === 'school' ? teacherUser.school : teacherId;

    for (let i = 0; i < numCourses; i++) {
      const course = generateCourse(teacherId, ownerType, ownerId);
      courses.push(course);
    }
  });

  // Step 6: Generate Ratings
  console.log('⭐ Generating ratings...');
  teachers.forEach(teacherId => {
    const teacherCourses = courses.filter(c =>
      c.teachers.some((t: Types.ObjectId) => t.equals(teacherId))
    );
    if (teacherCourses.length === 0) return;

    const numRatings = faker.number.int(RATINGS_PER_TEACHER);
    for (let i = 0; i < numRatings; i++) {
      const course = randomElement(teacherCourses);
      const student = randomElement(students);
      const rating = generateRating(teacherId, course._id, student);
      ratings.push(rating);
    }
  });

  // Calculate average ratings for teachers
  console.log('📊 Calculating average ratings...');
  const teacherRatings = new Map<string, number[]>();
  ratings.forEach(rating => {
    const teacherIdStr = rating.teacher.toString();
    if (!teacherRatings.has(teacherIdStr)) {
      teacherRatings.set(teacherIdStr, []);
    }
    teacherRatings.get(teacherIdStr)!.push(rating.rating);
  });

  teacherRatings.forEach((ratingsList, teacherIdStr) => {
    const avgRating = ratingsList.reduce((a, b) => a + b, 0) / ratingsList.length;
    const teacherUser = users.find(u => u._id.toString() === teacherIdStr);
    if (teacherUser) {
      teacherUser.averageRating = parseFloat(avgRating.toFixed(2));
    }
  });

  // Summary
  console.log('\n✅ Data generation complete!');
  console.log(`   Total Users: ${users.length}`);
  console.log(`   Teacher Profiles: ${teacherProfiles.length}`);
  console.log(`   Courses: ${courses.length}`);
  console.log(`   Ratings: ${ratings.length}\n`);

  return { users, teacherProfiles, courses, ratings };
}

// MongoDB insertion function
async function insertData(data: any) {
  const { users, teacherProfiles, courses, ratings } = data;

  try {
    console.log('💾 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/HelloK12LocalAggregation');

    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }

    console.log('🗑️  Clearing existing data...');
    await mongoose.connection.db.collection('users').deleteMany({});
    await mongoose.connection.db.collection('teacherprofiles').deleteMany({});
    await mongoose.connection.db.collection('courses').deleteMany({});
    await mongoose.connection.db.collection('teacherfeedbacks').deleteMany({});

    console.log('📥 Inserting users...');
    await mongoose.connection.db.collection('users').insertMany(users);

    console.log('📥 Inserting teacher profiles...');
    await mongoose.connection.db.collection('teacherprofiles').insertMany(teacherProfiles);

    console.log('📥 Inserting courses...');
    await mongoose.connection.db.collection('courses').insertMany(courses);

    console.log('📥 Inserting ratings...');
    await mongoose.connection.db.collection('teacherfeedbacks').insertMany(ratings);

    console.log('\n✨ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

// Run the script
async function main() {
  try {
    const data = await seedDatabase();
    await insertData(data);

    console.log('\n🎉 All done! Your database is ready for benchmarking.');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Execute
main();
