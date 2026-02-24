import dotenv from 'dotenv';
import { connectDB } from '../config/db';
import { User } from '../models/user.model';
import { notificationService } from '../modules/notifications/notification.service';

dotenv.config();

async function run() {
  await connectDB();

  const users = await User.find({
    role: { $in: ['super_admin', 'school', 'teacher', 'parent', 'student'] }
  })
    .select('_id role school')
    .limit(50)
    .lean();

  if (!users.length) {
    console.log('No users found to seed notifications');
    process.exit(0);
  }

  for (const user of users) {
    await notificationService.create({
      recipientUserId: String(user._id),
      type: 'ADMIN_ACTION',
      title: 'Welcome to notifications',
      message: 'This is a seeded notification for development and QA.',
      metadata: {
        deepLink: `/${user.role === 'super_admin' ? 'admin' : user.role}/notifications`,
        seeded: true
      }
    });

    await notificationService.create({
      recipientUserId: String(user._id),
      type: 'LESSON_UPDATED',
      title: 'Schedule updated',
      message: 'A lesson schedule was updated. Please review the latest timeline.',
      metadata: {
        deepLink: `/${user.role === 'super_admin' ? 'admin' : user.role}/notifications`,
        seeded: true
      }
    });
  }

  console.log(`Seeded notifications for ${users.length} users`);
  process.exit(0);
}

run().catch(error => {
  console.error('Notification seed failed', error);
  process.exit(1);
});
