export const getTeacherFilters = (query: any) => {
  const filters = {
    school: query?.school && query.school,
    languages: query?.languages && query.languages,
    experience: query?.experience && query.experience,
    availability: query?.availability && (query.availability as string).split(','),
    ageRange: query?.ageRange && query.ageRange,
    rating: query?.rating && Number(query.rating as string),
    price: query?.price && JSON.parse(query.price as string),
    name: query?.name && query.name,
    mode: query?.mode && JSON.parse(query.mode as string),
    lessonType: query?.lessonType && JSON.parse(query.lessonType as string),
    isTrialAvailable: query?.isTrialAvailable && (query.isTrialAvailable as string) === 'true'
  };
  const pagination = {
    offset: parseInt(query.offset as string),
    limit: parseInt(query.limit as string)
  };

  return { filters, pagination };
};
