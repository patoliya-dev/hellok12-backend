import { SessionModel, SessionStatus } from '../../models/sessions.model';
import { Course } from '../../models/course.model';
import { Lesson } from '../../models/lesson.model';
import zoomService from './zoom.service';
import Logger from '../../utils/winstonLogger.utils';

const toBoundedInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

const COMPLETE_WINDOW_BEFORE_MINUTES = toBoundedInt(
  process.env.SESSION_COMPLETE_WINDOW_BEFORE_MINUTES,
  30,
  0,
  24 * 60
);
const COMPLETE_WINDOW_AFTER_MINUTES = toBoundedInt(
  process.env.SESSION_COMPLETE_WINDOW_AFTER_MINUTES,
  12 * 60,
  0,
  7 * 24 * 60
);

const sessionService = {
  /**
   * Create a session for a lesson with Zoom meeting
   */
  createSessionForLesson: async (lessonData: {
    lessonId: string;
    courseId: string;
    teacherId: string;
    start: Date;
    end: Date;
    students?: string[];
  }) => {
    try {
      const { lessonId, courseId, teacherId, start, end, students = [] } = lessonData;

      // Validate lesson and course exist
      const [lesson, course] = await Promise.all([
        Lesson.findById(lessonId),
        Course.findById(courseId)
      ]);

      if (!lesson) {
        throw new Error('Lesson not found');
      }

      if (!course) {
        throw new Error('Course not found');
      }

      // Prepare session data
      const sessionData: any = {
        course: courseId,
        lesson: lessonId,
        teacher: teacherId,
        students: students, //Enrollments
        start,
        end,
        status: SessionStatus.SCHEDULED
      };

      // Create Zoom meeting if mode is ONLINE and provider is ZOOM

      if (!zoomService.isConfigured()) {
        Logger.warning('Zoom not configured. Session created without meeting link.');
      } else if (course.mode === 'online') {
        try {
          const duration = zoomService.calculateDuration(start, end);
          const zoomMeeting = await zoomService.createMeeting({
            topic: `${course.title} - ${lesson.title}`,
            type: 2,
            start_time: zoomService.formatZoomDate(start),
            duration,
            timezone: 'UTC',
            agenda: lesson.description || `Online session for ${lesson.title}`,
            settings: {
              host_video: true,
              participant_video: true,
              join_before_host: false,
              mute_upon_entry: true,
              waiting_room: true,
              audio: 'both',
              auto_recording: 'none'
            }
          });
          sessionData.meetingId = zoomMeeting.id.toString();
          sessionData.joinUrl = zoomMeeting.join_url;
          sessionData.hostUrl = zoomMeeting.start_url;
          sessionData.tokenMeta = {
            token: zoomMeeting.password || '',
            expiresAt: end
          };

          Logger.info(`Zoom meeting created for lesson ${lessonId}: ${zoomMeeting.id}`);
        } catch (zoomError: any) {
          Logger.error('Failed to create Zoom meeting:', zoomError);
        }
      }

      const session = await SessionModel.create(sessionData);

      const populatedSession = await SessionModel.findById(session._id)
        .populate('teacher', 'name email profileImage')
        // .populate('students', 'name email profileImage')
        .populate('course', 'title')
        .populate('lesson', 'title description');

      return populatedSession;
    } catch (error: any) {
      Logger.error('Error creating session:', error);
      throw error;
    }
  },

  updateSessionForLesson: async (lessonData: {
    lessonId: string;
    courseId: string;
    teacherId: string;
    start: Date;
    end: Date;
    students?: string[];
  }) => {
    try {
      const { lessonId, courseId, teacherId, start, end, students } = lessonData;

      const existingSession = await SessionModel.findOne({ lesson: lessonId });

      if (!existingSession) {
        // If no session exists, create one (similar to createSessionForLesson)
        return await sessionService.createSessionForLesson({
          lessonId,
          courseId,
          teacherId,
          start,
          end,
          students
        });
      }

      // Get lesson and course details
      const [lesson, course] = await Promise.all([
        Lesson.findById(lessonId),
        Course.findById(courseId)
      ]);

      if (!lesson || !course) {
        throw new Error('Lesson or Course not found');
      }

      // Update session data
      const updateData: any = {
        start,
        end,
        teacher: teacherId,
        course: courseId,
        students: students || existingSession.students
      };

      // If Zoom is configured and session has a meeting, update it
      if (zoomService.isConfigured() && existingSession.meetingId) {
        try {
          const duration = zoomService.calculateDuration(start, end);
          await zoomService.updateMeeting(existingSession.meetingId, {
            topic: `${course.title} - ${lesson.title}`,
            start_time: zoomService.formatZoomDate(start),
            duration,
            timezone: 'UTC',
            agenda: lesson.description || `Online session for ${lesson.title}`
          });

          updateData.tokenMeta = {
            token: existingSession.tokenMeta?.token || '',
            expiresAt: end
          };

          Logger.info(`Zoom meeting updated for lesson ${lessonId}: ${existingSession.meetingId}`);
        } catch (zoomError: any) {
          Logger.error('Failed to update Zoom meeting:', zoomError);

          // If update fails, try to create a new meeting
          try {
            const duration = zoomService.calculateDuration(start, end);
            const zoomMeeting = await zoomService.createMeeting({
              topic: `${course.title} - ${lesson.title}`,
              type: 2,
              start_time: zoomService.formatZoomDate(start),
              duration,
              timezone: 'UTC',
              agenda: lesson.description || `Online session for ${lesson.title}`,
              settings: {
                host_video: true,
                participant_video: true,
                join_before_host: false,
                mute_upon_entry: true,
                waiting_room: true,
                audio: 'both',
                auto_recording: 'none'
              }
            });

            updateData.meetingId = zoomMeeting.id.toString();
            updateData.joinUrl = zoomMeeting.join_url;
            updateData.hostUrl = zoomMeeting.start_url;
            updateData.tokenMeta = {
              token: zoomMeeting.password || '',
              expiresAt: end
            };

            Logger.info(`New Zoom meeting created for lesson ${lessonId}: ${zoomMeeting.id}`);
          } catch (createError) {
            Logger.error('Failed to create new Zoom meeting:', createError);
          }
        }
      }

      // Update the session

      const updatedSession = await SessionModel.findByIdAndUpdate(
        existingSession._id,
        { $set: updateData },
        { new: true }
      )
        .populate('teacher', 'name email profileImage')
        .populate('course', 'title')
        .populate('lesson', 'title description');

      return updatedSession;
    } catch (error: any) {
      Logger.error('Error updating session:', error);
      throw error;
    }
  },

  deleteSessionForLesson: async (lessonId: string) => {
    try {
      const session = await SessionModel.findOne({ lesson: lessonId });

      if (session && session.meetingId && zoomService.isConfigured()) {
        try {
          await zoomService.deleteMeeting(session.meetingId);
          Logger.info(`Zoom meeting deleted for lesson ${lessonId}: ${session.meetingId}`);
        } catch (zoomError) {
          Logger.error('Failed to delete Zoom meeting:', zoomError);
        }
      }

      await SessionModel.deleteOne({ lesson: lessonId });
    } catch (error: any) {
      Logger.error('Error deleting session:', error);
      throw error;
    }
  },

  completeSessionByTeacher: async (args: {
    sessionId: string;
    teacherId: string;
    note?: string;
  }) => {
    const { sessionId, teacherId, note } = args;

    const session = await SessionModel.findById(sessionId)
      .select('_id teacher status start end completedAt completedBy completionNote')
      .lean();

    if (!session) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    if (String(session.teacher) !== String(teacherId)) {
      throw Object.assign(new Error('Forbidden: session does not belong to this teacher'), {
        statusCode: 403
      });
    }

    if (session.status === SessionStatus.CANCELLED) {
      throw Object.assign(new Error('Cancelled sessions cannot be marked as completed'), {
        statusCode: 409
      });
    }

    if (session.status === SessionStatus.COMPLETED) {
      return { session, alreadyCompleted: true };
    }

    const now = new Date();
    const windowStart = new Date(
      session.start.getTime() - COMPLETE_WINDOW_BEFORE_MINUTES * 60 * 1000
    );
    const windowEnd = new Date(session.end.getTime() + COMPLETE_WINDOW_AFTER_MINUTES * 60 * 1000);

    if (now < windowStart || now > windowEnd) {
      throw Object.assign(
        new Error(
          `Session can only be completed from ${windowStart.toISOString()} to ${windowEnd.toISOString()}`
        ),
        { statusCode: 409 }
      );
    }

    const updated = await SessionModel.findOneAndUpdate(
      {
        _id: session._id,
        teacher: session.teacher,
        status: { $in: [SessionStatus.SCHEDULED, SessionStatus.IN_PROGRESS] }
      },
      {
        $set: {
          status: SessionStatus.COMPLETED,
          completedAt: now,
          completedBy: session.teacher,
          ...(typeof note === 'string' ? { completionNote: note.trim() } : {})
        }
      },
      { new: true }
    ).lean();

    if (!updated) {
      const latest = await SessionModel.findById(session._id)
        .select('_id teacher status start end completedAt completedBy completionNote')
        .lean();
      if (latest?.status === SessionStatus.COMPLETED) {
        return { session: latest, alreadyCompleted: true };
      }

      throw Object.assign(new Error('Session is not in a completable state'), { statusCode: 409 });
    }

    return { session: updated, alreadyCompleted: false };
  }
};

export default sessionService;
