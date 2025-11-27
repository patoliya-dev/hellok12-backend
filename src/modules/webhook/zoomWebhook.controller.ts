// import { Request, Response } from 'express';
// import crypto from 'crypto';
// import config from '../../config/config';
// import { SessionModel, SessionStatus } from '../../models/sessions.model';
// import Logger from '../../utils/winstonLogger.utils';

// export const zoomWebhookHandler = async (req: Request, res: Response) => {
//   try {
//     // Step 1: Verify webhook signature
//     const isValid = verifyZoomWebhook(req);

//     if (!isValid) {
//       Logger.error('Invalid Zoom webhook signature');
//       return res.status(401).json({ message: 'Unauthorized' });
//     }

//     const event = req.body;

//     if (event.event === 'endpoint.url_validation') {
//       const hashForValidate = crypto
//         .createHmac('sha256', config.zoomWebhookSecretToken)
//         .update(event.payload.plainToken)
//         .digest('hex');

//       return res.status(200).json({
//         plainToken: event.payload.plainToken,
//         encryptedToken: hashForValidate
//       });
//     }

//     Logger.info(`Received Zoom webhook: ${event.event}`);

//     switch (event.event) {
//       case 'meeting.started':
//         await handleMeetingStarted(event.payload);
//         break;

//       case 'meeting.ended':
//         await handleMeetingEnded(event.payload);
//         break;

//       default:
//         Logger.info(`Unhandled event type: ${event.event}`);
//     }

//     return res.status(200).json({ message: 'Webhook processed successfully' });
//   } catch (error: any) {
//     Logger.error('Zoom webhook processing error:', error);
//     return res.status(500).json({ message: 'Internal server error' });
//   }
// };

// const verifyZoomWebhook = (req: Request): boolean => {
//   const signature = req.headers['x-zm-signature'] as string;
//   const timestamp = req.headers['x-zm-request-timestamp'] as string;

//   if (!signature || !timestamp) {
//     return false;
//   }

//   // Prevent replay attacks (reject requests older than 5 minutes)
//   const currentTimestamp = Math.floor(Date.now() / 1000);
//   if (Math.abs(currentTimestamp - parseInt(timestamp)) > 300) {
//     Logger.warn('Webhook timestamp too old, possible replay attack');
//     return false;
//   }

//   const message = `v0:${timestamp}:${JSON.stringify(req.body)}`;

//   const hashForVerify = crypto
//     .createHmac('sha256', config.zoomWebhookSecretToken)
//     .update(message)
//     .digest('hex');

//   const expectedSignature = `v0=${hashForVerify}`;

//   try {
//     return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
//   } catch (error) {
//     return false;
//   }
// };

// const handleMeetingStarted = async (payload: any) => {
//   try {
//     const meetingId = payload.object.id.toString();
//     const startTime = new Date(payload.object.start_time);

//     const session = await SessionModel.findOne({ meetingId });

//     if (!session) {
//       Logger.warn(`Session not found for meeting ID: ${meetingId}`);
//       return;
//     }

//     if (session.status === SessionStatus.SCHEDULED) {
//       session.status = SessionStatus.IN_PROGRESS;
//       session.start = startTime;
//       await session.save();
//       Logger.info(`Session ${session._id} started via webhook at ${startTime}`);
//     }
//   } catch (error) {
//     Logger.error('Error handling meeting started:', error);
//   }
// };

// const handleMeetingEnded = async (payload: any) => {
//   try {
//     const meetingId = payload.object.id.toString();
//     const endTime = new Date(payload.object.end_time);

//     const session = await SessionModel.findOne({ meetingId });

//     if (!session) {
//       Logger.warn(`Session not found for meeting ID: ${meetingId}`);
//       return;
//     }

//     if (session.status === SessionStatus.IN_PROGRESS) {
//       session.status = SessionStatus.COMPLETED;
//       session.end = endTime;
//       await session.save();
//       Logger.info(`Session ${session._id} ended via webhook at ${endTime}`);
//     }
//   } catch (error) {
//     Logger.error('Error handling meeting ended:', error);
//   }
// };
