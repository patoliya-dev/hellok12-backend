import { Invitation } from '../../models/invitation.model';
import { hashToken, normalizeEmail } from './invitation.util';
import { mapInvitationForApi } from './invitation.mapper';
import { User } from '../../models/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { throwHttp } from '../../utils/httpError';

type AcceptPayload = {
  inviteId: string;
  ticket: string;
  fullName?: string;
  password?: string;
  // optional: if you later want to support authenticated accept:
  // authUserEmail?: string;
};

const getRedirectForRole = (role: string) => {
  const r = String(role || '').toLowerCase();
  if (r) return `/${r}/dashboard`;
  return '/';
};

export const InvitationService = {
  validate: async (inviteId: string, ticket: string) => {
    const inv = await Invitation.findById(inviteId);

    // HARD STOP – type-safe narrowing
    if (inv === null) {
      return throwHttp('Invitation not found', 404);
    }

    if (inv.inviteToken !== hashToken(ticket)) {
      return throwHttp('Invalid invitation token', 401);
    }

    // Auto-expire pending invitations
    if (inv.status === 'pending' && inv.expiresAt < new Date()) {
      inv.status = 'expired';
      await inv.save();

      return throwHttp('This invitation has expired. Please request a new one.', 410, {
        status: 'EXPIRED'
      });
    }

    switch (inv.status) {
      case 'pending':
        return {
          invite: mapInvitationForApi(inv)
        };

      case 'cancelled':
        return throwHttp('This invitation was cancelled by the school.', 410, {
          status: 'CANCELLED'
        });

      case 'accepted':
        return throwHttp('This invitation has already been accepted.', 409, { status: 'ACCEPTED' });

      case 'rejected':
        return throwHttp('This invitation is no longer valid.', 410, { status: 'REJECTED' });

      case 'expired':
        return throwHttp('This invitation has expired.', 410, { status: 'EXPIRED' });

      default:
        return throwHttp('Invalid invitation state', 400);
    }
  },

  accept: async ({ inviteId, ticket, fullName, password }: AcceptPayload) => {
    const inv = await Invitation.findById(inviteId);
    if (!inv) throw Object.assign(new Error('Invitation not found'), { statusCode: 404 });

    if (inv.inviteToken !== hashToken(ticket))
      throw Object.assign(new Error('Invalid token'), { statusCode: 401 });

    if (inv.status !== 'pending')
      throw Object.assign(new Error('Already processed'), { statusCode: 409 });

    if (inv.expiresAt < new Date()) {
      inv.status = 'expired';
      await inv.save();
      throw Object.assign(new Error('Invitation expired'), { statusCode: 410 });
    }

    const email = normalizeEmail(inv.recipientEmail);
    let user = await User.findOne({ email });

    if (!user) {
      if (!password || !fullName)
        throw Object.assign(new Error('Account details required'), { statusCode: 422 });
      // const salt = await bcrypt.genSalt(12);
      user = await User.create({
        email,
        name: fullName,
        isVerified: true,
        role: String(inv.recipientRole).toLowerCase(),
        password: password,
        ...(inv.inviterRole === 'school'
          ? { school: inv.organization || inv.invitedBy }
          : { admin: inv.organization || inv.invitedBy })
      });
    } else {
      // IMPORTANT: existing user -> must prove identity before issuing token
      if (!password) {
        throw Object.assign(
          new Error('Password required to accept invitation for an existing account'),
          { statusCode: 422 }
        );
      }
      const ok = await bcrypt.compare(password, user.password ?? '');
      if (!ok) throw Object.assign(new Error('Invalid password'), { statusCode: 401 });
    }

    // Link to school + approval state for teacher
    if (String(inv.recipientRole).toLowerCase() === 'teacher') {
      if (inv.inviterRole === 'school') user.school = inv.organization || inv.invitedBy;
      if (inv.inviterRole === 'super_admin') user.admin = inv.organization || inv.invitedBy;
      user.profile = { ...(user.profile || {}), status: 'pending_approval' };
    }

    if (String(inv.recipientRole)?.toLowerCase() === 'student') {
      if (inv.inviterRole === 'school') user.school = inv.organization || inv.invitedBy;
      if (inv.inviterRole === 'super_admin') user.admin = inv.organization || inv.invitedBy;
      user.status = 'active';
    }

    await user.save();

    inv.status = 'accepted';
    inv.acceptedAt = new Date();
    await inv.save();

    const accessToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET!, {
      expiresIn: '7d'
    });

    // Return safe DTO if you have one; keeping minimal here
    return {
      user: {
        id: user._id.toString(),
        email: user.email!,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
        ...((user.role === 'teacher' && user.school && { schoolId: user.school }) || {})
      },
      accessToken,
      redirectTo: getRedirectForRole(user.role)
    };
  }
};
