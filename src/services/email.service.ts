import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import config from '../config/config';
import Logger from '../utils/winstonLogger.utils';

interface TemplateContext {
  [key: string]: string | number | boolean | object | undefined;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

// Create transporter
const transporter = nodemailer.createTransport({
  service: config.emailService,
  auth: {
    user: config.emailUser,
    pass: config.emailPass
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  rateLimit: 14
});

// Verify transporter
transporter.verify((error, success) => {
  if (error) {
    Logger.error('Email transporter verification failed:', error);
  } else {
    Logger.info('Email transporter is ready to send messages');
  }
});

// Template cache and setup
const templateCache = new Map<string, HandlebarsTemplateDelegate>();
let templatesInitialized = false;

// Initialize Handlebars partials and helpers
const initializeTemplates = () => {
  if (templatesInitialized) return;

  try {
    // Register helpers
    Handlebars.registerHelper('eq', function (a, b) {
      return a === b;
    });

    Handlebars.registerHelper('ne', function (a, b) {
      return a !== b;
    });

    templatesInitialized = true;
    Logger.info('Handlebars templates initialized successfully');
  } catch (error) {
    Logger.error('Failed to initialize templates:', error);
  }
};

// Enhanced template compiler with better fallback logic
const compileTemplate = (templateName: string, context: TemplateContext): string => {
  initializeTemplates();

  try {
    let template = templateCache.get(templateName);

    if (!template) {
      const templatePath = path.join(__dirname, `../templates/${templateName}.hbs`);
      Logger.info('Looking for template at:', templatePath);

      if (!fs.existsSync(templatePath)) {
        Logger.warn(
          `Template ${templateName}.hbs not found at ${templatePath}, using enhanced fallback`
        );
        return createEnhancedFallbackTemplate(templateName, context);
      }

      const source = fs.readFileSync(templatePath, 'utf8');
      template = Handlebars.compile(source);
      templateCache.set(templateName, template);
    }

    // Enhanced context with global variables
    const enhancedContext = {
      ...context,
      verificationLink: context.token
        ? `${config.clientURL}/verify-email?token=${context.token}`
        : undefined,
      resetLink: context.token
        ? `${config.clientURL}/reset-password?token=${context.token}`
        : undefined,
      loginUrl: `${config.clientURL}/login`,
      currentYear: new Date().getFullYear(),
      appName: 'HelloK12',
      supportEmail: 'support@hellok12.com',
      clientURL: config.clientURL
    };

    return template(enhancedContext);
  } catch (err) {
    Logger.error(`Failed to compile template ${templateName}:`, err);
    return createEnhancedFallbackTemplate(templateName, context);
  }
};

// Enhanced fallback template creator with role-specific content
const createEnhancedFallbackTemplate = (templateName: string, context: TemplateContext): string => {
  const baseStyle = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HelloK12</title>
        <style>
            body { 
                margin: 0; 
                padding: 0; 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                background-color: #f5f7fa; 
                line-height: 1.6;
            }
            .email-container { 
                max-width: 600px; 
                margin: 20px auto; 
                background-color: #ffffff; 
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 30px;
                text-align: center;
                color: white;
            }
            .logo { 
                font-size: 28px; 
                font-weight: bold; 
                margin-bottom: 10px;
                letter-spacing: 1px;
            }
            .hello { color: #FFE66D; }
            .k12 { color: #FF6B6B; }
            .tagline { font-size: 14px; opacity: 0.9; }
            .content { 
                padding: 40px; 
                background-color: #ffffff;
            }
            .title { 
                font-size: 24px; 
                font-weight: bold; 
                color: #2c3e50; 
                margin-bottom: 20px; 
                text-align: center; 
            }
            .greeting {
                font-size: 16px;
                color: #7f8c8d;
                margin-bottom: 20px;
            }
            .message { 
                font-size: 16px; 
                color: #34495e; 
                line-height: 1.8; 
                margin-bottom: 30px; 
            }
            .cta-section {
                text-align: center;
                margin: 40px 0;
            }
            .cta-button { 
                display: inline-block; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                text-decoration: none; 
                padding: 16px 40px; 
                border-radius: 30px; 
                font-size: 16px; 
                font-weight: bold;
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
                transition: transform 0.2s;
            }
            .cta-button:hover {
                transform: translateY(-2px);
            }
            .info-box {
                background-color: #f8f9fa;
                border-left: 4px solid #667eea;
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
            }
            .footer { 
                background-color: #2c3e50; 
                color: #ecf0f1; 
                text-align: center; 
                padding: 30px;
            }
            .contact-info {
                margin-bottom: 15px;
                font-size: 14px;
            }
            .contact-item {
                display: inline-block;
                margin: 0 15px;
            }
            .footer-links {
                margin: 15px 0;
                font-size: 13px;
            }
            .footer-links a {
                color: #3498db;
                text-decoration: none;
                margin: 0 10px;
            }
            .security-note {
                font-size: 12px;
                opacity: 0.8;
                margin-top: 15px;
            }
            ul {
                padding-left: 20px;
            }
            li {
                margin-bottom: 8px;
            }
            .highlight {
                background-color: #fff3cd;
                padding: 15px;
                border-radius: 6px;
                border: 1px solid #ffeaa7;
                margin: 20px 0;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <div class="logo">
                    <span class="hello">Hell</span>🌍<span class="k12">K12</span>
                </div>
                <div class="tagline">Your Learning Journey Starts Here</div>
            </div>
            <div class="content">
  `;

  const footer = `
            </div>
            <div class="footer">
                <div class="contact-info">
                    <div class="contact-item">📧 support@hellok12.com</div>
                    <div class="contact-item">📞 +1 (555) 123-4567</div>
                </div>
                <div class="footer-links">
                    <a href="${config.clientURL}/privacy">Privacy Policy</a>
                    <a href="${config.clientURL}/terms">Terms of Service</a>
                    <a href="${config.clientURL}/support">Support</a>
                </div>
                <div class="security-note">
                    🔒 Secure & Encrypted • © ${new Date().getFullYear()} HelloK12
                </div>
            </div>
        </div>
    </body>
    </html>
  `;

  switch (templateName) {
    case 'student-verification':
      return `${baseStyle}
                <div class="title">🎓 Welcome Student!</div>
                <div class="greeting">Dear ${context.name},</div>
                <div class="message">
                    <p><strong>Welcome to HelloK12!</strong> We're thrilled to have you join our learning community.</p>
                    
                    <p>As a student, you'll have access to:</p>
                    <ul>
                        <li>📚 Interactive courses with expert teachers</li>
                        <li>🎮 Fun learning games and activities</li>
                        <li>📊 Progress tracking and achievements</li>
                        <li>🤝 Connect with students worldwide</li>
                        <li>📝 Assignments and homework help</li>
                    </ul>
                    
                    <p>To start your learning journey, please verify your email address:</p>
                </div>
                
                <div class="cta-section">
                    <a href="${config.clientURL}/verify-email?token=${context.token}" class="cta-button">
                        ✨ Verify & Start Learning
                    </a>
                </div>
                
                <div class="info-box">
                    <p><strong>What happens next?</strong></p>
                    <ol>
                        <li>Click the verification button above</li>
                        <li>You'll be redirected to your student dashboard</li>
                        <li>Complete your profile setup</li>
                        <li>Start exploring courses and join classes!</li>
                    </ol>
                </div>
                
                <div class="highlight">
                    <p><strong>⏰ Important:</strong> This verification link will expire in 24 hours for security reasons.</p>
                    <p>If the button doesn't work, copy this link: <br>
                    <small style="word-break: break-all; color: #667eea;">${config.clientURL}/verify-email?token=${context.token}</small></p>
                </div>
            ${footer}`;

    case 'parent-verification':
      return `${baseStyle}
                <div class="title">👨‍👩‍👧‍👦 Welcome Parent!</div>
                <div class="greeting">Dear ${context.name},</div>
                <div class="message">
                    <p><strong>Thank you for choosing HelloK12!</strong> You've successfully created an account for your family.</p>
                    
                    <p>You've registered <strong>${context.childrenCount} ${context.childrenText}</strong> for our platform.</p>
                    
                    <p>As a parent, you can:</p>
                    <ul>
                        <li>📊 Monitor your ${context.childrenText}'s progress</li>
                        <li>📅 Schedule and manage lessons</li>
                        <li>💬 Communicate with teachers</li>
                        <li>🎯 Set learning goals</li>
                        <li>💳 Manage payments and subscriptions</li>
                    </ul>
                </div>
                
                <div class="cta-section">
                    <a href="${config.clientURL}/verify-email?token=${context.token}" class="cta-button">
                        👨‍👩‍👧‍👦 Verify Family Account
                    </a>
                </div>
                
                <div class="info-box">
                    <p><strong>After verification:</strong></p>
                    <p>Both you and your ${context.childrenText} will have full access to HelloK12. Your children can start learning immediately!</p>
                </div>
            ${footer}`;

    case 'teacher-verification':
      return `${baseStyle}
                <div class="title">🍎 Welcome Teacher!</div>
                <div class="greeting">Dear ${context.name},</div>
                <div class="message">
                    <p><strong>Welcome to HelloK12!</strong> We're excited to have you join our community of educators.</p>
                    
                    <p>As a teacher, you can:</p>
                    <ul>
                        <li>📖 Create and manage courses</li>
                        <li>👥 Teach students globally</li>
                        <li>💰 Set your rates and earn income</li>
                        <li>📊 Track student progress</li>
                        <li>🤝 Connect with other educators</li>
                    </ul>
                </div>
                
                <div class="cta-section">
                    <a href="${config.clientURL}/verify-email?token=${context.token}" class="cta-button">
                        🍎 Verify & Start Teaching
                    </a>
                </div>
            ${footer}`;

    case 'school-verification':
      return `${baseStyle}
                <div class="title">🏫 Welcome School!</div>
                <div class="greeting">Dear ${context.schoolName} Team,</div>
                <div class="message">
                    <p><strong>Welcome to HelloK12!</strong> We're honored to partner with your institution.</p>
                    
                    <p>Your school account provides:</p>
                    <ul>
                        <li>👥 Student & teacher management</li>
                        <li>📚 Course administration</li>
                        <li>📊 Analytics and reporting</li>
                        <li>💰 Financial management</li>
                    </ul>
                    
                    <p><strong>Next steps:</strong> Verify email → Complete profile → Wait for approval</p>
                </div>
                
                <div class="cta-section">
                    <a href="${config.clientURL}/verify-email?token=${context.token}" class="cta-button">
                        🏫 Verify School Account
                    </a>
                </div>
            ${footer}`;

    case 'forgot-password':
      return `${baseStyle}
                <div class="title">🔐 Password Reset</div>
                <div class="greeting">Dear ${context.name},</div>
                <div class="message">
                    <p>We received a request to reset your HelloK12 password.</p>
                    <p>Your 6-digit verification code is:</p>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: inline-block; padding: 20px 30px; border-radius: 10px; font-size: 24px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', monospace;">
                        ${context.code}
                    </div>
                </div>
                
                <div class="info-box">
                    <p><strong>How to use this code:</strong></p>
                    <ol>
                        <li>Return to the password reset page</li>
                        <li>Enter this code: <strong>${context.code}</strong></li>
                        <li>Create your new password</li>
                    </ol>
                    <p><strong>⏰ This code expires in ${context.expiryMinutes} minutes.</strong></p>
                </div>
            ${footer}`;

    default:
      return `${baseStyle}
                <div class="title">📧 HelloK12 Notification</div>
                <div class="greeting">Dear ${context.name || 'User'},</div>
                <div class="message">
                    <p>You have received a notification from HelloK12.</p>
                    <p>If you have any questions, please contact our support team.</p>
                </div>
            ${footer}`;
  }
};

// Enhanced send email function (same as before)
const sendEmail = async (to: string, subject: string, html: string, retries = 3): Promise<void> => {
  if (!to) {
    Logger.warn('No recipient provided, skipping email send');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    Logger.error(`Invalid email format: ${to}`);
    throw new Error('Invalid email format');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await transporter.sendMail({
        from: {
          name: 'HelloK12',
          address: config.emailFrom
        },
        to,
        subject,
        html,
        text: html
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      });

      Logger.info(`Email sent successfully to ${to}`, {
        messageId: info.messageId,
        subject,
        attempt
      });

      if (config.env === 'development') {
        const previewUrl = nodemailer.getTestMessageUrl(info as any) || (info as any).messageId;
        Logger.info('📧 Email preview:', previewUrl);
      }

      return;
    } catch (err) {
      Logger.error(`Email send attempt ${attempt} failed:`, err);

      if (attempt === retries) {
        Logger.error(`Failed to send email after ${retries} attempts`, { to, subject });
        throw new Error(`Email sending failed after ${retries} attempts`);
      }

      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
};

// Email service with all methods
export const emailService = {
  // Generic verification email
  sendVerificationEmail: async (to: string, token: string, name?: string): Promise<void> => {
    try {
      const html = compileTemplate('verification', {
        token,
        name: name || 'User',
        userType: 'user'
      });
      await sendEmail(to, 'Verify Your Email Address - HelloK12', html);
      Logger.info(`Verification email sent to ${to}`);
    } catch (error) {
      Logger.error('Failed to send verification email:', error);
      throw error;
    }
  },

  // Role-specific verification emails
  sendStudentVerificationEmail: async (to: string, token: string, name: string): Promise<void> => {
    try {
      Logger.info('Sending student verification email with enhanced fallback template');
      const html = compileTemplate('student-verification', {
        token,
        name,
        userType: 'student',
        dashboardUrl: `${config.clientURL}/student-parent/dashboard`
      });
      await sendEmail(to, 'Welcome to HelloK12 - Verify Your Student Account', html);
      Logger.info(`Student verification email sent to ${to}`);
    } catch (error) {
      Logger.error('Failed to send student verification email:', error);
      throw error;
    }
  },

  sendParentVerificationEmail: async (
    to: string,
    token: string,
    name: string,
    childrenCount: number
  ): Promise<void> => {
    try {
      const html = compileTemplate('parent-verification', {
        token,
        name,
        childrenCount,
        userType: 'parent',
        childrenText: childrenCount === 1 ? 'child' : 'children',
        dashboardUrl: `${config.clientURL}/student-parent/dashboard`
      });
      await sendEmail(to, `Welcome to HelloK12 - Verify Your Parent Account`, html);
      Logger.info(`Parent verification email sent to ${to} for ${childrenCount} children`);
    } catch (error) {
      Logger.error('Failed to send parent verification email:', error);
      throw error;
    }
  },

  sendTeacherVerificationEmail: async (to: string, token: string, name: string): Promise<void> => {
    try {
      const html = compileTemplate('teacher-verification', {
        token,
        name,
        userType: 'teacher',
        dashboardUrl: `${config.clientURL}/teacher/dashboard`
      });
      await sendEmail(to, 'Welcome to HelloK12 - Verify Your Teacher Account', html);
      Logger.info(`Teacher verification email sent to ${to}`);
    } catch (error) {
      Logger.error('Failed to send teacher verification email:', error);
      throw error;
    }
  },

  sendSchoolVerificationEmail: async (
    to: string,
    token: string,
    schoolName: string
  ): Promise<void> => {
    try {
      const html = compileTemplate('school-verification', {
        token,
        schoolName,
        userType: 'school',
        dashboardUrl: `${config.clientURL}/school/dashboard`
      });
      await sendEmail(to, `Welcome to HelloK12 - Verify Your School Account`, html);
      Logger.info(`School verification email sent to ${to} for ${schoolName}`);
    } catch (error) {
      Logger.error('Failed to send school verification email:', error);
      throw error;
    }
  },

  // Password reset emails
  sendVerificationCode: async (options: {
    email: string;
    name: string;
    code: string;
    expiryMinutes: number;
  }): Promise<void> => {
    const { email, name, code, expiryMinutes } = options;

    try {
      const html = compileTemplate('forgot-password', {
        name,
        code,
        expiryMinutes
      });

      await sendEmail(email, 'Reset Your Password - Verification Code - HelloK12', html);
      Logger.info(`Password reset code sent to ${email}`);
    } catch (error) {
      Logger.error('Failed to send verification code:', error);
      throw error;
    }
  },

  sendPasswordResetCode: async (email: string, name: string, code: string): Promise<void> => {
    try {
      await emailService.sendVerificationCode({
        email,
        name,
        code,
        expiryMinutes: 15
      });
    } catch (error) {
      Logger.error('Failed to send password reset code:', error);
      throw error;
    }
  },

  sendPasswordChangeConfirmation: async (email: string, name: string): Promise<void> => {
    try {
      const html = compileTemplate('password-changed', {
        name,
        email,
        loginUrl: `${config.clientURL}/login`,
        changeTime: new Date().toLocaleString()
      });
      await sendEmail(email, 'Password Changed Successfully - HelloK12', html);
      Logger.info(`Password change confirmation sent to ${email}`);
    } catch (error) {
      Logger.error('Failed to send password change confirmation:', error);
      throw error;
    }
  },

  sendWelcomeEmail: async (email: string, name: string, userType: string): Promise<void> => {
    try {
      const dashboardUrls = {
        student: '/student-parent/dashboard',
        parent: '/student-parent/dashboard',
        teacher: '/teacher/dashboard',
        school: '/school/dashboard'
      };

      const html = compileTemplate('welcome', {
        name,
        userType,
        dashboardUrl: `${config.clientURL}${dashboardUrls[userType as keyof typeof dashboardUrls] || '/dashboard'}`,
        supportUrl: `${config.clientURL}/support`
      });

      await sendEmail(email, `Welcome to HelloK12, ${name}!`, html);
      Logger.info(`Welcome email sent to ${email}`);
    } catch (error) {
      Logger.error('Failed to send welcome email:', error);
      // Don't throw error for welcome email - it's not critical
    }
  },

  // Test email configuration
  testEmailConfiguration: async (): Promise<boolean> => {
    try {
      await transporter.verify();
      Logger.info('Email configuration test passed');
      return true;
    } catch (error) {
      Logger.error('Email configuration test failed:', error);
      return false;
    }
  }
};

// Export for backward compatibility
export const sendVerificationEmail = emailService.sendVerificationEmail;
export const sendVerificationCode = emailService.sendVerificationCode;

export default emailService;
