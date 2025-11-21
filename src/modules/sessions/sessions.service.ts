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
        // students: students.length > 0 ? students : ((course as any).students || []).map((s: any) => s._id), //Enrollments
        start,
        end,
        status: SessionStatus.SCHEDULED
      };

      // Create Zoom meeting if mode is ONLINE and provider is ZOOM

      if (!zoomService.isConfigured()) {
        Logger.warning('Zoom not configured. Session created without meeting link.');
      } else {
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
  }
};

export default sessionService;
