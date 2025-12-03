import { SessionModel, SessionStatus } from '../../models/sessions.model';
import { Course } from '../../models/course.model';
import { Lesson } from '../../models/lesson.model';
import zoomService from './zoom.service';
import Logger from '../../utils/winstonLogger.utils';

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
      console.log(session);
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
  }
};

export default sessionService;
