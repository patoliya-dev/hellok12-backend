import { Invitation } from '../../models/invitation.model';
import { hashToken, normalizeEmail } from './invitation.util';
import { mapInvitationForApi } from './invitation.mapper';
import { User } from '../../models/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { throwHttp } from '../../utils/httpError';
import { Types } from 'mongoose';

type AcceptPayload = {
  inviteId: string;
  ticket: string;
  fullName?: string;
  password?: string;
};

const getRedirectForRole = (role: string) => {
  const r = String(role || '').toLowerCase();
  if (r) return `/${r}/dashboard`;
  return '/';
};

const isObjectId = (v: any) => Types.ObjectId.isValid(String(v || ''));

const normalizeRole = (r: any) =>
  String(r || '')
    .trim()
    .toLowerCase();
const normalizeInviterRole = (r: any) =>
  String(r || '')
    .trim()
    .toLowerCase();

const isTeacherSchoolInvite = (inv: any) => {
  const inviterRole = normalizeInviterRole(inv?.inviterRole);
  const metaType = normalizeRole(inv?.meta?.teacherType);
  // School inviter always means school teacher invite
  if (inviterRole === 'school') return true;
  // Super admin school teacher invite stored in meta.teacherType
  if (metaType === 'school') return true;
  return false;
};

const isTeacherIndependentInvite = (inv: any) => {
  const metaType = normalizeRole(inv?.meta?.teacherType);
  return metaType === 'independent';
};

export const InvitationService = {
  validate: async (inviteId: string, ticket: string) => {
    const inv = await Invitation.findById(inviteId);

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
        return { invite: mapInvitationForApi(inv) };

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

    const recipientRole = normalizeRole(inv.recipientRole);
    const inviterRole = normalizeInviterRole(inv.inviterRole);

    const email = normalizeEmail(inv.recipientEmail);
    let user = await User.findOne({ email });

    // organization can be null now (independent teacher invite)
    const org = inv.organization || null;
    const orgId = org && isObjectId(org) ? org : null;

    // create user if missing
    if (!user) {
      if (!password || !fullName) {
        throw Object.assign(new Error('Account details required'), { statusCode: 422 });
      }

      user = await User.create({
        email,
        name: fullName,
        isVerified: true,
        role: recipientRole,
        password
      });
    } else {
      // existing user must confirm password
      if (!password) {
        throw Object.assign(
          new Error('Password required to accept invitation for an existing account'),
          { statusCode: 422 }
        );
      }
      const ok = await bcrypt.compare(password, user.password ?? '');
      if (!ok) throw Object.assign(new Error('Invalid password'), { statusCode: 401 });
    }

    /**
     * Association rules (aligned with new SUPER_ADMIN teacher invite update)
     */

    // TEACHER
    if (recipientRole === 'teacher') {
      // If school teacher invite: link schoolId from invitation.organization
      if (isTeacherSchoolInvite(inv)) {
        if (orgId) user.school = orgId;
      }

      // If independent teacher invite: ensure school is not set by invitation
      if (isTeacherIndependentInvite(inv)) {
        // do not assign school (leave as-is)
        // (optional) if you want to ensure no school is attached for new teachers, uncomment:
        // if (!user._id) user.school = undefined; // not recommended; keep safe
      }

      // keep your "admin" link if inviter is super_admin
      if (inviterRole === 'super_admin') {
        // store who invited (platform) for traceability
        user.admin = (isObjectId(inv.invitedBy) ? inv.invitedBy : user.admin) as any;
      }

      user.profile = { ...(user.profile || {}), status: 'pending_approval' };
    }

    // STUDENT
    if (recipientRole === 'student') {
      if (inviterRole === 'school') {
        // school inviter: org must be school
        if (orgId) user.school = orgId;
        else if (isObjectId(inv.invitedBy)) user.school = inv.invitedBy as any;
      }

      if (inviterRole === 'super_admin') {
        // keep existing behavior (admin relationship)
        if (isObjectId(inv.invitedBy)) user.admin = inv.invitedBy as any;
      }

      user.status = 'active';
    }

    // PARENT (kept consistent / safe)
    if (recipientRole === 'parent') {
      if (inviterRole === 'school') {
        if (orgId) user.school = orgId;
        else if (isObjectId(inv.invitedBy)) user.school = inv.invitedBy as any;
      }

      if (inviterRole === 'super_admin') {
        if (isObjectId(inv.invitedBy)) user.admin = inv.invitedBy as any;
      }

      // parent status: do not force active unless you want
      // user.status = user.status || 'active';
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
        ...(user.role === 'teacher' && user.school ? { schoolId: user.school } : {})
      },
      accessToken,
      redirectTo: getRedirectForRole(user.role)
    };
  }
};
