import path from 'path';

export const EMAIL_TEMPLATE_DIR =
  process.env.NODE_ENV === 'production'
    ? path.resolve(process.cwd(), 'dist/templates')
    : path.resolve(process.cwd(), 'src/templates');
