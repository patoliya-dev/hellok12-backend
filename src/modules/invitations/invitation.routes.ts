import { Router } from 'express';
import { invitationController } from './invitation.controller';

const router = Router();

router.get('/validate', invitationController.validateInvitation);
router.post('/accept', invitationController.acceptInvitation);

export default router;
