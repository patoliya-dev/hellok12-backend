import { InvitationDoc } from '../../models/invitation.model';

export const mapInvitationForApi = (inv: InvitationDoc | any) => ({
  _id: inv._id,
  recipientEmail: inv.recipientEmail,
  recipientRole: inv.recipientRole,
  invitationMessage: inv.invitationMessage || '',
  status: String(inv.status).toUpperCase(),
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
  inviterRole: inv.inviterRole,
  organization: inv.organization ?? null,
  meta: inv.meta ?? {}
});
