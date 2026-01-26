import { Types } from 'mongoose';
import { Lesson } from '../../models/lesson.model';
import { Course } from '../../models/course.model';

export async function recomputeCourseTeachers(courseId: Types.ObjectId) {
  const rows = await Lesson.find({
    courseId,
    status: { $ne: 'archived' }
  })
    .select({ teacherId: 1 })
    .lean();

  const teacherIds = Array.from(
    new Set(
      rows
        .map(r => r.teacherId)
        .filter(Boolean)
        .map(id => String(id))
    )
  ).map(id => new Types.ObjectId(id));

  await Course.updateOne({ _id: courseId }, { $set: { teachers: teacherIds } });
}
