import { Types } from 'mongoose';

interface FrontendFilters {
  school?: string; // ObjectId
  languages?: string; // "en"
  experience?: string; // "3-5"
  ageRange?: string; // "6-8"
  ratings?: string; // e.g. "4"
  price?: string[]; // e.g. ["10", "100"]
}

/**
 * Builds the teacher filter query for MongoDB aggregation.
 * Includes both direct user fields (role, school)
 * and nested profile filters (languages, experience, ageRange)
 * and price range handling for course relation.
 */
export const buildTeacherQuery = (filters: FrontendFilters) => {
  const { school, languages, experience, ageRange, ratings, price } = filters;
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

  if (ratings) {
    query.averageRating = { $gte: Number(ratings) };
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
};

export const getTeacherFilters = (query: any) => {
  const filters = {
    school: query?.school && query.school,
    languages: query?.languages && query.languages,
    experience: query?.experience && query.experience,
    availability: query?.availability && (query.availability as string).split(','),
    ageRange: query?.ageRange && query.ageRange,
    rating: query?.rating && Number(query.rating as string),
    price: query?.price && JSON.parse(query.price as string)
  };
  const pagination = {
    offset: parseInt(query.offset as string),
    limit: parseInt(query.limit as string)
  };

  return { filters, pagination };
};
