// src/types/express.d.ts
import 'express-serve-static-core';
import type { ParsedQs } from 'qs';

declare global {
  // Reuse your UploadedFile shape so file uploads work everywhere
  interface UploadedFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination?: string;
    filename?: string;
    path?: string;
    buffer?: Buffer;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Injected by validateRequest middleware */
    validatedBody?: any;
    validatedQuery?: ParsedQs | Record<string, any>;
    validatedParams?: Record<string, string>;

    /** File props (multer-compatible shape) */
    file?: UploadedFile;
    files?: UploadedFile[] | { [fieldname: string]: UploadedFile[] };
  }
}
