import { FilterQuery, Types } from 'mongoose';
import { Notification, INotification } from '../../models/notification.model';
import { UserPayload } from '../../types/UserPayload';

type ListFilters = {
  unread?: boolean;
  type?: string;
  roleTargeted?: boolean;
  startDate?: Date;
  endDate?: Date;
  recipientUserId?: string;
};

const toObjectId = (value: string) => new Types.ObjectId(value);

export const NotificationRepository = {
  buildVisibilityFilter(user: UserPayload): FilterQuery<INotification> {
    const userId = toObjectId(user.id);
    const audienceBranch: any = { audienceRoles: user.role };

    const scopedSchoolId = user.role === 'school' ? user.id : user.schoolId;
    if (scopedSchoolId && Types.ObjectId.isValid(scopedSchoolId)) {
      audienceBranch.$or = [
        { audienceSchoolId: null },
        { audienceSchoolId: { $exists: false } },
        { audienceSchoolId: toObjectId(scopedSchoolId) }
      ];
    }

    return {
      $or: [{ recipientUserId: userId }, audienceBranch]
    };
  },

  buildListFilter(user: UserPayload, filters: ListFilters): FilterQuery<INotification> {
    const baseFilter = this.buildVisibilityFilter(user);

    if (user.role === 'super_admin' && filters.recipientUserId) {
      baseFilter.$or = [{ recipientUserId: toObjectId(filters.recipientUserId) }];
    }

    if (typeof filters.unread === 'boolean') {
      (baseFilter as any).isRead = !filters.unread ? { $in: [true, false] } : false;
      if (!filters.unread) {
        delete (baseFilter as any).isRead;
      }
    }

    if (filters.type) {
      (baseFilter as any).type = filters.type;
    }

    if (typeof filters.roleTargeted === 'boolean') {
      if (filters.roleTargeted) {
        (baseFilter as any).audienceRoles = { $exists: true, $ne: [] };
      } else {
        (baseFilter as any).recipientUserId = { $ne: null };
      }
    }

    if (filters.startDate || filters.endDate) {
      (baseFilter as any).createdAt = {
        ...(filters.startDate ? { $gte: filters.startDate } : {}),
        ...(filters.endDate ? { $lte: filters.endDate } : {})
      };
    }

    return baseFilter;
  },

  async list(user: UserPayload, filters: ListFilters, page: number, limit: number) {
    const query = this.buildListFilter(user, filters);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('title message type metadata isRead readAt createdAt recipientUserId audienceRoles')
        .lean(),
      Notification.countDocuments(query)
    ]);

    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  },

  async unreadCount(user: UserPayload) {
    const query = {
      ...this.buildVisibilityFilter(user),
      isRead: false
    };

    return Notification.countDocuments(query);
  },

  async markAsRead(user: UserPayload, notificationId: string) {
    const visibility = this.buildVisibilityFilter(user);
    return Notification.findOneAndUpdate(
      {
        _id: toObjectId(notificationId),
        ...visibility
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      },
      { new: true }
    )
      .select('title message type metadata isRead readAt createdAt')
      .lean();
  },

  async markAllAsRead(user: UserPayload, type?: string) {
    const visibility = this.buildVisibilityFilter(user);
    const query: any = {
      ...visibility,
      isRead: false
    };
    if (type) query.type = type;

    const out = await Notification.updateMany(query, {
      $set: {
        isRead: true,
        readAt: new Date()
      }
    });

    return Number((out as any)?.modifiedCount || 0);
  },

  async removeForUser(user: UserPayload, notificationId: string) {
    const visibility = this.buildVisibilityFilter(user);
    const out = await Notification.deleteOne({
      _id: toObjectId(notificationId),
      ...visibility
    });
    return Number((out as any)?.deletedCount || 0) > 0;
  },

  async createMany(payloads: Array<Partial<INotification>>) {
    if (!payloads.length) return [];
    return Notification.insertMany(payloads, { ordered: false });
  }
};
