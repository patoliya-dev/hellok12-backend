import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import crypto from 'crypto';

export const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function makePresignedPost({
  bucket,
  key,
  contentType,
  maxBytes,
  expiresSeconds = 60
}: {
  bucket: string;
  key: string;
  contentType: string;
  maxBytes: number;
  expiresSeconds?: number;
}) {
  return createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    Conditions: [
      ['content-length-range', 1, maxBytes],
      ['starts-with', '$Content-Type', contentType.split('/')[0] + '/']
    ],
    Fields: { 'Content-Type': contentType, 'x-amz-server-side-encryption': 'AES256' },
    Expires: expiresSeconds
  });
}

export async function headObject(bucket: string, key: string) {
  const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return res;
}

export function buildS3Path(options: {
  entityType: string; // e.g., 'course', 'user'
  entityId: string; // optional: primary key of entity
  prefix?: string; // optional subfolder
  ext: string; // file extension
}): string {
  const { entityType, entityId, prefix, ext } = options;

  const uuid = crypto.randomUUID();

  const baseFolder = entityType.toLowerCase();

  const parts: string[] = [baseFolder];

  if (entityId) parts.push(entityId);

  if (prefix) parts.push(prefix);

  parts.push(uuid + '.' + ext);

  return parts.join('/');
}
