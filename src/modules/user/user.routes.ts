// src/modules/parents/parents.routes.ts
import express from 'express';
import * as userController from './user.controller';
import { authenticate } from '../../middlewares/auth';

const router = express.Router();

router.get('/:parentId/students', authenticate, userController.getParentStudents);

export default router;
