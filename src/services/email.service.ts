import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import config from '../config/config';

interface TemplateContext {
  [key: string]: string | number | boolean | object | undefined;
}


// Create a reusable transporter using Gmail + App Password
const transporter = nodemailer.createTransport({
  service: config.emailService,
  auth: {
    user: config.emailUser,
    pass: config.emailPass, // App password
  },
});

// Helper: compile Handlebars template
const compileTemplate = (templateName: string, context: TemplateContext): string => {
  try {
    const templatePath = path.join(__dirname, `../templates/${templateName}.hbs`);
    const source = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(source);
    return template({ ...context, verificationLink: `${config.clientURL + 'verify-email?token=' + context.token}` });
  } catch (err) {
    console.error(`Failed to load template ${templateName}:`, err);
    throw new Error('Email template loading failed');
  }
};

// Generic email sending
const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
  if (!to) return; // Skip if no recipient

  try {
    const info = await transporter.sendMail({
      from: config.emailFrom,
      to,
      subject,
      html,
    });

    // if (config.env === 'development') {
    console.log('📧 Email sent:', nodemailer.getTestMessageUrl(info) || info.messageId);
    // }
  } catch (err) {
    console.error('Failed to send email:', err);
    throw new Error('Email sending failed');
  }
};

// Send verification email
export const sendVerificationEmail = async (to: string, token: string): Promise<void> => {
  const html = compileTemplate('verification', { token });
  await sendEmail(to, 'Verify Your Email Address', html);
};

interface ForgotPasswordEmailOptions {
  email: string;
  name: string;
  code: string;
  expiryMinutes: number;
}

export const sendVerificationCode = async (options: ForgotPasswordEmailOptions) => {
  const { email, name, code, expiryMinutes } = options;

  const html = compileTemplate('forgot-password', {
    name,
    code,
    expiryMinutes,
    year: new Date().getFullYear(),
  });

  const mailOptions = {
    from: config.emailFrom,
    to: email,
    subject: 'Reset Your Password - Verification Code',
    html,
  };

  await transporter.sendMail(mailOptions);
};

// Send password reset email
export const sendResetPasswordEmail = async (to: string, token: string, name: string): Promise<void> => {
  const html = compileTemplate('reset-password', { name, token, clientURL: config.clientURL });
  await sendEmail(to, 'Reset Your Password', html);
};
