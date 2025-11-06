import { Types } from 'mongoose';

interface FrontendFilters {
  school?: string;
  languages?: string;
  experience?: string; // e.g. "3-5"
  ageRange?: string; // e.g. "6-8"
  ratings?: string; // e.g. "4"
  price?: string[]; // e.g. ["10", "100"]
}

/**
 * Builds the teacher filter query for MongoDB aggregation.
 * Includes both direct user fields (role, school)
 * and nested profile filters (languages, experience, ageRange)
 * and price range handling for course relation.
 */
export const buildTeacherFilters = (filters: FrontendFilters) => {
  const { school, languages, experience, ageRange, ratings, price } = filters;

  // Base filter for teachers
  const query: any = {
    role: 'teacher',
    $and: []
  };

  // School filter
  if (school) {
    query.$and.push({ school: new Types.ObjectId(school) });
  }

  // Language filter
  if (languages) {
    query.$and.push({ 'profile.teachingLanguages': languages });
  }

  //  Experience filter
  if (experience) {
    const [min, max] = experience.split('-').map(Number);
    query.$and.push({
      'profile.yearsOfExperience': { $gte: min, $lte: max }
    });
  }

  // Age range filter
  if (ageRange) {
    query.$and.push({ 'profile.ageGroupTeach': ageRange });
  }

  // Rating filter
  if (ratings) {
    query.$and.push({ averageRating: { $gte: Number(ratings) } });
  }

  // Price range filter
  let priceRange = { min: price ? Number(price[0]) : 0, max: price ? Number(price[1]) : 1000 };
  if (price && Array.isArray(price)) {
    const [minPrice, maxPrice] = price;
    priceRange = { min: Number(minPrice), max: Number(maxPrice) };
  }

  // Clean up empty $and
  if (query.$and.length === 0) {
    delete query.$and;
  }

  return { query, priceRange };
};

export const getTeacherFilters = (query: any) => {
  const filters = {
    school: query?.school && null,
    languages: query?.languages && query.languages,
    experience: query?.experience && query.experience,
    availability: query?.availability && (query.availability as string).split(','),
    ageRange: query?.ageRange && query.ageRange,
    rating: query?.ratings && parseFloat(query.ratings as string),
    price: query?.price && JSON.parse(query.price as string)
  };

  const pagination = {
    offset: parseInt(query.offset as string),
    limit: parseInt(query.limit as string)
  };

  return { filters, pagination };
};
