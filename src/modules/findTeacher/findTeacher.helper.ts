export const getTeacherFilters = (query: any) => {
  const isTrialAvailable = parseBooleanQuery(query?.isTrialAvailable);

  const filters = {
    school: query?.school && query.school,
    languages: query?.languages && query.languages,
    experience: query?.experience && query.experience,
    availability: query?.availability && parseAvailabilityFilter(query.availability),
    ageRange: query?.ageRange && query.ageRange,
    rating: query?.rating && Number(query.rating as string),
    price: query?.price && JSON.parse(query.price as string),
    name: query?.name && query.name,
    mode: query?.mode && JSON.parse(query.mode as string),
    lessonType: query?.lessonType && JSON.parse(query.lessonType as string),
    isTrialAvailable
  };
  const pagination = {
    offset: parseInt(query.offset as string),
    limit: parseInt(query.limit as string)
  };

  return { filters, pagination };
};

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

/**
 * Parse availability filter from query string
 * Expected formats:
 * - Single date: "2025-12-05"
 * - Date with time: "2025-12-05T10:00"
 * - Date range: "2025-12-05,2025-12-10"
 * - Multiple dates: "2025-12-05,2025-12-07,2025-12-09"
 */
function parseAvailabilityFilter(availability: string) {
  const parts = availability.split(',');

  if (parts.length === 1) {
    // Single date or datetime
    return { type: 'single', value: parts[0] };
  } else if (parts.length === 2) {
    const [first, second] = parts;
    // Check if it's a date range (both are dates without time)
    if (!first.includes('T') && !second.includes('T')) {
      return { type: 'range', start: first, end: second };
    }
    // Multiple specific dates
    return { type: 'multiple', dates: parts };
  } else {
    // Multiple specific dates
    return { type: 'multiple', dates: parts };
  }
}
