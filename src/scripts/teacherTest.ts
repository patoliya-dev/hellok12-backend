import { faker } from '@faker-js/faker';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'fs';

// Configuration
const TOTAL_USERS = 1000;
const ROLE_DISTRIBUTION = {
  teacher: 0.5, // 30% teachers (3000)
  student: 0.2, // 50% students (5000)
  parent: 0.1, // 15% parents (1500)
  school: 0.2 // 5% schools (500)
};

const COURSES_PER_TEACHER = { min: 2, max: 8 };
const RATINGS_PER_TEACHER = { min: 5, max: 50 };
const AGE_GROUPS = ['3-5', '6-8', '9-11', '12-14', '15-17', '18+'];
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
    // Generate unique email with timestamp to avoid duplicates
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    user.email =
      `${faker.internet.username()}.${timestamp}.${random}@${faker.internet.domainName()}`.toLowerCase();
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

// Create indexes function
async function createIndexes() {
  console.log('🔧 Creating database indexes...\n');

  try {
    const db = mongoose.connection.db;

    if (!db) {
      throw new Error('Database connection not established');
    }
    // Users collection indexes
    console.log('📇 Creating indexes on users collection...');
    await db.collection('users').createIndex({ role: 1 });
    await db.collection('users').createIndex({ role: 1, school: 1 });
    await db.collection('users').createIndex({ role: 1, averageRating: 1 });
    await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
    await db.collection('users').createIndex({ status: 1 });
    console.log('   ✅ Users indexes created');

    // TeacherProfiles collection indexes
    console.log('📇 Creating indexes on teacherprofiles collection...');
    await db.collection('teacherprofiles').createIndex({ user: 1 }, { unique: true });
    await db.collection('teacherprofiles').createIndex({ teachingLanguages: 1 });
    await db.collection('teacherprofiles').createIndex({ yearsOfExperience: 1 });
    await db.collection('teacherprofiles').createIndex({ ageGroupTeach: 1 });
    await db.collection('teacherprofiles').createIndex({
      teachingLanguages: 1,
      yearsOfExperience: 1
    });
    await db.collection('teacherprofiles').createIndex({
      'location.coordinates': '2dsphere'
    });
    console.log('   ✅ TeacherProfiles indexes created');

    // Courses collection indexes
    console.log('📇 Creating indexes on courses collection...');
    await db.collection('courses').createIndex({ teachers: 1 });
    await db.collection('courses').createIndex({ teachers: 1, price: 1 });
    await db.collection('courses').createIndex({ price: 1 });
    await db.collection('courses').createIndex({ status: 1 });
    await db.collection('courses').createIndex({ ownerType: 1, ownerId: 1 });
    await db.collection('courses').createIndex({ language: 1 });
    await db.collection('courses').createIndex({ startDate: 1 });
    await db.collection('courses').createIndex({ isTrialAvailable: 1 });
    console.log('   ✅ Courses indexes created');

    // feedbackratings collection indexes
    console.log('📇 Creating indexes on feedbackratings collection...');
    await db.collection('feedbackratings').createIndex({ teacher: 1 });
    await db.collection('feedbackratings').createIndex({ teacher: 1, rating: 1 });
    await db.collection('feedbackratings').createIndex({ course: 1 });
    await db.collection('feedbackratings').createIndex({ lesson: 1 });
    await db.collection('feedbackratings').createIndex({ author: 1 });
    console.log('   ✅ feedbackratings indexes created');

    // Attachments collection indexes (if used)
    console.log('📇 Creating indexes on attachments collection...');
    await db.collection('attachments').createIndex({ entityId: 1, entityType: 1 });
    await db.collection('attachments').createIndex({ entityId: 1, entityType: 1, status: 1 });
    console.log('   ✅ Attachments indexes created');

    console.log('\n✅ All indexes created successfully!\n');

    // Show index stats
    const collections = ['users', 'teacherprofiles', 'courses', 'feedbackratings'];
    console.log('📊 Index Summary:');
    for (const collName of collections) {
      const indexes = await db.collection(collName).indexes();
      console.log(`   ${collName}: ${indexes.length} indexes`);
    }
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    throw error;
  }
}

// MongoDB insertion function
async function insertData(data: any) {
  const { users, teacherProfiles, courses, ratings } = data;

  try {
    console.log('💾 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/test_db');

    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }
    console.log('🗑️  Clearing existing data...');
    await mongoose.connection.db.collection('users').deleteMany({});
    await mongoose.connection.db.collection('teacherprofiles').deleteMany({});
    await mongoose.connection.db.collection('courses').deleteMany({});
    await mongoose.connection.db.collection('feedbackratings').deleteMany({});

    console.log('📥 Inserting users...');
    await mongoose.connection.db.collection('users').insertMany(users);

    console.log('📥 Inserting teacher profiles...');
    await mongoose.connection.db.collection('teacherprofiles').insertMany(teacherProfiles);

    console.log('📥 Inserting courses...');
    await mongoose.connection.db.collection('courses').insertMany(courses);

    console.log('📥 Inserting ratings...');
    await mongoose.connection.db.collection('feedbackratings').insertMany(ratings);

    console.log('\n✨ Database seeded successfully!');

    // Create indexes after data insertion
    await createIndexes();
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

const getTeacherFilters = (query: any) => {
  console.log(query);
  const filters = {
    school: query.school && query.school,
    languages: query.languages && query.languages,
    experience: query.experience && query.experience,
    availability: query.availability && (query.availability as string).split(','),
    ageRange: query.ageRange && query.ageRange,
    rating: query.rating && Number(query.rating as string),
    price:
      query.price && query.price.length === 2 && Array.isArray(query.price)
        ? query.price
        : query.price && JSON.parse(query.price as string)
  };
  const pagination = {
    offset: parseInt(query.offset as string),
    limit: parseInt(query.limit as string)
  };

  return { filters, pagination };
};

// Benchmark function
async function runBenchmarks() {
  console.log('\n🔥 Starting Performance Benchmarks...\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test_db');

    const testScenarios = [
      {
        name: '1️⃣  No filters (baseline)',
        filters: {},
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '2️⃣  Single filter: Language',
        filters: { languages: 'en' },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '3️⃣  Single filter: Experience',
        filters: { experience: '5-10' },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '4️⃣  Single filter: Age Group',
        filters: { ageRange: '9-11' },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '5️⃣  Single filter: Price Range',
        filters: { price: [50, 200] },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '6️⃣  Single filter: Rating',
        filters: { rating: 4 },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '7️⃣  Two filters: Language + Experience',
        filters: { languages: 'sp', experience: '3-7' },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '8️⃣  Two filters: Price + Rating',
        filters: { price: [100, 300], rating: 3 },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '9️⃣  Three filters: Language + Experience + Age',
        filters: {
          languages: 'en',
          experience: '5-15',
          ageRange: '12-14'
        },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '🔟 Four filters: Language + Experience + Price + Rating',
        filters: {
          languages: 'fr',
          experience: '2-10',
          price: [50, 250],
          rating: 4
        },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '1️⃣1️⃣  All filters combined',
        filters: {
          school: null, // Will be set dynamically
          languages: 'en',
          experience: '5-15',
          ageRange: '9-11',
          price: [100, 300],
          rating: 3
        },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '1️⃣2️⃣  High pagination offset',
        filters: { languages: 'en' },
        pagination: { offset: 500, limit: 8 }
      },
      {
        name: '1️⃣3️⃣  Large page size',
        filters: { experience: '3-10' },
        pagination: { offset: 0, limit: 18 }
      },
      {
        name: '1️⃣4️⃣  Price filter only (tests course lookup)',
        filters: { price: [20, 100] },
        pagination: { offset: 0, limit: 8 }
      },
      {
        name: '1️⃣5️⃣  Expensive price range (fewer results)',
        filters: { price: [400, 500] },
        pagination: { offset: 0, limit: 8 }
      }
    ];

    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }

    // Get a random school ID for scenario 11
    const randomSchool = await mongoose.connection.db
      .collection('users')
      .findOne({ role: 'school' });
    if (randomSchool) {
      (testScenarios[10] as any).filters.school = randomSchool._id.toString();
    }

    const results: any[] = [];

    for (const scenario of testScenarios) {
      console.log(`\n${scenario.name}`);
      console.log('─'.repeat(50));

      const { filters, pagination } = scenario;
      const formattedFilters = getTeacherFilters({ ...filters, ...pagination });

      // Build teacher query
      const teacherQuery = buildTeacherQuery(formattedFilters.filters);

      // Build aggregation pipeline
      const pipeline = buildAggregationPipeline({
        filters: formattedFilters.filters,
        teacherQuery,
        offset: pagination.offset,
        limit: pagination.limit
      });

      console.log(`📋 Filters: ${JSON.stringify(filters, null, 2)}`);
      console.log(`📄 Pipeline stages: ${pipeline.length}`);

      // Run query with timing
      const startTime = Date.now();

      const teachersData = await mongoose.connection.db
        .collection('users')
        .aggregate(pipeline)
        .toArray();

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Get explain plan for analysis
      const explainResult = await mongoose.connection.db
        .collection('users')
        .aggregate(pipeline, { explain: true })
        .toArray();

      const stats = explainResult[0]?.stages || [];
      const totalDocsExamined = stats.reduce((sum: number, stage: any) => {
        return sum + (stage?.nReturned || 0);
      }, 0);

      console.log(`✅ Results: ${teachersData.length} teachers`);
      console.log(`⏱️  Execution time: ${executionTime}ms`);
      console.log(`📊 Documents examined: ~${totalDocsExamined}`);

      // Performance rating
      let rating = '🟢 Excellent';
      if (executionTime > 100) rating = '🟡 Good';
      if (executionTime > 500) rating = '🟠 Fair';
      if (executionTime > 1000) rating = '🔴 Slow';
      console.log(`${rating}`);

      results.push({
        scenario: scenario.name,
        filters,
        resultsCount: teachersData.length,
        executionTime,
        docsExamined: totalDocsExamined,
        pipelineStages: pipeline.length
      });

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Summary report
    console.log('\n\n' + '═'.repeat(70));
    console.log('📊 BENCHMARK SUMMARY');
    console.log('═'.repeat(70) + '\n');

    const avgTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
    const maxTime = Math.max(...results.map(r => r.executionTime));
    const minTime = Math.min(...results.map(r => r.executionTime));

    console.log(`Average execution time: ${avgTime.toFixed(2)}ms`);
    console.log(`Fastest query: ${minTime}ms`);
    console.log(`Slowest query: ${maxTime}ms`);

    console.log('\n📈 Top 5 Slowest Queries:');
    results
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.scenario} - ${r.executionTime}ms`);
      });

    console.log('\n⚡ Top 5 Fastest Queries:');
    results
      .sort((a, b) => a.executionTime - b.executionTime)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.scenario} - ${r.executionTime}ms`);
      });

    console.log('\n💡 Recommendations:');
    const slowQueries = results.filter(r => r.executionTime > 500);
    if (slowQueries.length > 0) {
      console.log(`   ⚠️  ${slowQueries.length} queries took over 500ms`);
      console.log('   → Consider adding indexes');
      console.log('   → Review pipeline optimization');
    } else {
      console.log('   ✅ All queries performing well!');
    }

    // Export results to JSON
    fs.writeFileSync('benchmark-results.json', JSON.stringify(results, null, 2));
    console.log('\n💾 Detailed results saved to: benchmark-results.json');
  } catch (error) {
    console.error('❌ Benchmark error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

// Helper: Build teacher query (like your newBuildTeacherFilters)
function buildTeacherQuery(filters: any) {
  const { school, languages, experience, ageRange, rating, price } = filters;

  const query: Record<string, any> = { role: 'teacher' };

  if (school) {
    query.school = new Types.ObjectId(school);
  }

  if (languages) {
    query['profile.teachingLanguages'] = languages;
  }

  if (experience) {
    const [min, max] = experience.split('-').map(Number);
    query['profile.yearsOfExperience'] = { $gte: min, $lte: max };
  }

  if (ageRange) {
    query['profile.ageGroupTeach'] = ageRange;
  }

  if (rating) {
    query.averageRating = { $gte: Number(rating) };
  }

  let priceRange = { min: 0, max: 10000 };
  if (price && Array.isArray(price)) {
    const [minPrice, maxPrice] = price.map(Number);
    priceRange = {
      min: isNaN(minPrice) ? 0 : minPrice,
      max: isNaN(maxPrice) ? 10000 : maxPrice
    };
  }

  return { query, priceRange };
}

// Helper: Build aggregation pipeline (your optimized version)
function buildAggregationPipeline({ filters, teacherQuery, offset, limit }: any) {
  const pipeline: any[] = [];
  const { priceRange } = teacherQuery;

  // Initial match
  const initialMatch: any = { role: 'teacher' };
  if (filters.school) {
    initialMatch.school = new Types.ObjectId(filters.school);
  }

  pipeline.push({ $match: initialMatch });

  // Lookup profile
  pipeline.push({
    $lookup: {
      from: 'teacherprofiles',
      localField: '_id',
      foreignField: 'user',
      as: 'profile'
    }
  });

  pipeline.push({ $unwind: { path: '$profile' } });

  // Profile filters
  const profileMatch: any = {};

  if (filters.languages) {
    profileMatch['profile.teachingLanguages'] = filters.languages;
  }

  if (filters.experience) {
    const [min, max] = filters.experience.split('-').map(Number);
    profileMatch['profile.yearsOfExperience'] = { $gte: min, $lte: max };
  }

  if (filters.ageRange) {
    profileMatch['profile.ageGroupTeach'] = filters.ageRange;
  }

  if (Object.keys(profileMatch).length > 0) {
    pipeline.push({ $match: profileMatch });
  }

  if (filters.rating) {
    pipeline.push({
      $lookup: {
        from: 'feedbackratings',
        localField: '_id',
        foreignField: 'teacher',
        as: 'feedbacks'
      }
    });

    pipeline.push({
      $addFields: {
        averageRating: {
          $cond: [{ $gt: [{ $size: '$feedbacks' }, 0] }, { $avg: '$feedbacks.rating' }, null]
        }
      }
    });

    pipeline.push({
      $match: { averageRating: { $gte: Number(filters.rating) } }
    });
  }

  // Price filter
  if (priceRange && filters.price && Array.isArray(filters.price)) {
    const { min, max } = priceRange;
    pipeline.push({
      $lookup: {
        from: 'courses',
        let: { teacherId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$teacherId', '$teachers'] },
                  { $gte: ['$price', min] },
                  { $lte: ['$price', max] }
                ]
              }
            }
          },
          { $limit: 1 },
          { $project: { _id: 1 } }
        ],
        as: 'matchingCourses'
      }
    });

    pipeline.push({
      $match: { matchingCourses: { $ne: [] } }
    });
  }

  // Project
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      role: 1,
      isVerified: 1,
      averageRating: 1,
      'profile.teachingLanguages': 1,
      'profile.location': 1,
      'profile.teachingSpecialties': 1,
      'profile.yearsOfExperience': 1
    }
  });

  // Pagination
  if (offset && offset > 0) pipeline.push({ $skip: offset });
  if (limit && limit > 0) pipeline.push({ $limit: limit });

  return pipeline;
}

// Execute
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'both'; // 'seed', 'benchmark', or 'both'

  try {
    if (mode === 'seed' || mode === 'both') {
      const data = await seedDatabase();
      await insertData(data);
    }

    if (mode === 'benchmark' || mode === 'both') {
      console.log('\n⏳ Waiting 2 seconds before benchmarking...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await runBenchmarks();
    }

    console.log('\n🎉 All done!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
