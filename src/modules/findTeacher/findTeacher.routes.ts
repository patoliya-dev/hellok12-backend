import { Router } from 'express';
import { FindTeacherController } from './findTeacher.controller';

const router = Router();

router.get('/', FindTeacherController.findTeachers);
router.get('/:teacherId', FindTeacherController.getTeacher);

export default router;
