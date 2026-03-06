import { User } from '../../models/user.model';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const AdminService = {
  getSchools: async ({ page, limit, search }: { page: string; limit: string; search: string }) => {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(String(limit || '50'), 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const q: any = { role: 'school' };

    const term = String(search || '').trim();
    if (term) {
      const rx = new RegExp(escapeRegex(term), 'i');
      q.$or = [{ name: rx }, { email: rx }, { 'profile.schoolName': rx }];
    }

    const [total, schools] = await Promise.all([
      User.countDocuments(q),
      User.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('name email status profile createdAt')
        .lean()
    ]);

    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      schools,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  }
};
