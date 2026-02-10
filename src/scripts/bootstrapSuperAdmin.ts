import 'dotenv/config';
import mongoose from 'mongoose';

// Adjust these imports to your project structure
import { User } from '../models/user.model';
// If you already have constants, prefer importing them:
// import { USER_ROLES } from '../utils/constants';

const MONGODB_URI = process.env.MONGO_URI;

type Role = 'super_admin' | 'admin';

function must(v: string | undefined, key: string) {
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${key}`);
  return String(v).trim();
}

async function connectDB() {
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI (or DATABASE_URL)');
  await mongoose.connect(MONGODB_URI);
}

async function main() {
  try {
    const email = must('admin@yopmail.com', 'SUPER_ADMIN_EMAIL').toLowerCase();
    console.log('email', email);

    const password = must('admin@1234', 'SUPER_ADMIN_PASSWORD');
    console.log('password', password);

    const name = 'HelloK12 Super Admin'.trim();

    // optional controls
    const role = (process.env.SUPER_ADMIN_ROLE || 'super_admin').toLowerCase() as Role;
    const forceResetPassword =
      String(process.env.SUPER_ADMIN_FORCE_RESET_PASSWORD || 'false') === 'true';

    // Basic password safety
    if (password.length < 10) {
      throw new Error('SUPER_ADMIN_PASSWORD must be at least 10 characters');
    }

    await connectDB();

    const existing = await User.findOne({ email }).select('+password').lean(false);
    console.log('existing', existing);

    // const passwordHash = await bcrypt.hash(password, 12);

    if (existing) {
      const update: any = {
        name,
        role,
        status: 'active',
        isVerified: true
      };

      // Only reset password if explicitly asked
      if (forceResetPassword) update.password = password;

      await User.updateOne({ _id: existing._id }, { $set: update });

      // eslint-disable-next-line no-console
      console.log(
        `[bootstrapSuperAdmin] Updated existing user: ${email} (role=${role})` +
          (forceResetPassword ? ' [password reset]' : '')
      );
    } else {
      const user = await User.create({
        name,
        email,
        password: password,
        role, // 'super_admin'
        status: 'active',
        isVerified: true
      });
      console.log('user', user);

      // eslint-disable-next-line no-console
      console.log(`[bootstrapSuperAdmin] Created super admin: ${email} (role=${role})`);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.log('error', error);
  }
}

// main();

{
  /* 
  Run script with below command after build
  npm run bootstrap:superadmin
*/
}
