import axios from 'axios';
import jwt from 'jsonwebtoken';
import Logger from '../../utils/winstonLogger.utils';
import config from '../../config/config';

interface ZoomMeetingConfig {
  topic: string;
  type: number; // 1: Instant, 2: Scheduled, 3: Recurring no fixed time, 8: Recurring with fixed time
  start_time: string; // ISO 8601 format
  duration: number; // In minutes
  timezone?: string;
  agenda?: string;
  settings?: {
    host_video?: boolean;
    participant_video?: boolean;
    join_before_host?: boolean;
    mute_upon_entry?: boolean;
    waiting_room?: boolean;
    audio?: 'both' | 'telephony' | 'voip';
    auto_recording?: 'none' | 'local' | 'cloud';
  };
}

interface ZoomMeetingUpdateConfig {
  topic?: string;
  start_time?: string;
  duration?: number;
  timezone?: string;
  agenda?: string;
  settings?: {
    host_video?: boolean;
    participant_video?: boolean;
    join_before_host?: boolean;
    mute_upon_entry?: boolean;
    waiting_room?: boolean;
    audio?: 'both' | 'telephony' | 'voip';
    auto_recording?: 'none' | 'local' | 'cloud';
  };
}

interface ZoomMeetingResponse {
  id: number;
  uuid: string;
  host_id: string;
  topic: string;
  type: number;
  start_time: string;
  duration: number;
  timezone: string;
  created_at: string;
  join_url: string;
  start_url: string; // Host URL
  password?: string;
}

class ZoomService {
  private readonly accountId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.accountId = config.zoomAccountId || '';
    this.clientId = config.zoomClientId || '';
    this.clientSecret = config.zoomClientSecret || '';

    if (!this.accountId || !this.clientId || !this.clientSecret) {
      Logger.warning('Zoom credentials not configured. Zoom features will be disabled.');
    }
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${this.accountId}`,
        {},
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
      return this.accessToken as string;
    } catch (error: any) {
      Logger.error('Failed to get Zoom access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Zoom');
    }
  }

  /**
   * Create a Zoom meeting
   */
  async createMeeting(config: ZoomMeetingConfig): Promise<ZoomMeetingResponse> {
    try {
      const token = await this.getAccessToken();

      // Default settings for educational sessions
      const meetingConfig = {
        topic: config.topic,
        type: config.type || 2, // Scheduled meeting
        start_time: config.start_time,
        duration: config.duration,
        timezone: config.timezone || 'UTC',
        agenda: config.agenda || '',
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: false,
          mute_upon_entry: true,
          waiting_room: true,
          audio: 'both',
          auto_recording: 'none',
          ...config.settings
        }
      };

      const response = await axios.post('https://api.zoom.us/v2/users/me/meetings', meetingConfig, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error: any) {
      Logger.error('Failed to create Zoom meeting:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create Zoom meeting');
    }
  }

  /**
   * Update an existing Zoom meeting
   */
  async updateMeeting(meetingId: string, config: ZoomMeetingUpdateConfig): Promise<void> {
    try {
      const token = await this.getAccessToken();

      const updateConfig: any = {};

      if (config.topic !== undefined) updateConfig.topic = config.topic;
      if (config.start_time !== undefined) updateConfig.start_time = config.start_time;
      if (config.duration !== undefined) updateConfig.duration = config.duration;
      if (config.timezone !== undefined) updateConfig.timezone = config.timezone;
      if (config.agenda !== undefined) updateConfig.agenda = config.agenda;
      if (config.settings !== undefined) updateConfig.settings = config.settings;

      await axios.patch(`https://api.zoom.us/v2/meetings/${meetingId}`, updateConfig, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      Logger.info(`Zoom meeting ${meetingId} updated successfully`);
    } catch (error: any) {
      Logger.error('Failed to update Zoom meeting:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to update Zoom meeting');
    }
  }

  /**
   * Delete a Zoom meeting
   */
  async deleteMeeting(meetingId: string): Promise<void> {
    try {
      const token = await this.getAccessToken();

      await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      Logger.info(`Zoom meeting ${meetingId} deleted successfully`);
    } catch (error: any) {
      // If meeting not found (404), consider it already deleted
      if (error.response?.status === 404) {
        Logger.info(`Zoom meeting ${meetingId} not found, possibly already deleted`);
        return;
      }

      Logger.error('Failed to delete Zoom meeting:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to delete Zoom meeting');
    }
  }

  /**
   * Get meeting details
   */
  async getMeeting(meetingId: string): Promise<ZoomMeetingResponse> {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(`https://api.zoom.us/v2/meetings/${meetingId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return response.data;
    } catch (error: any) {
      Logger.error('Failed to get Zoom meeting:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to get Zoom meeting');
    }
  }

  /**
   * Calculate meeting duration in minutes
   */
  calculateDuration(startDate: Date, endDate: Date): number {
    return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60));
  }

  /**
   * Format date for Zoom API (ISO 8601)
   */
  formatZoomDate(date: Date): string {
    return date.toISOString();
  }

  /**
   * Check if Zoom is configured
   */
  isConfigured(): boolean {
    return !!(this.accountId && this.clientId && this.clientSecret);
  }
}

export default new ZoomService();
