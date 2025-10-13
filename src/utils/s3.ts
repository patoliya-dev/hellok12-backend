import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

// Create S3 client (uses default chain so it picks up AWS_SESSION_TOKEN automatically)
export const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Generate a presigned POST for direct S3 upload.
 * Automatically includes x-amz-security-token if session credentials are active.
 */
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
  try {
    // resolve current credentials (ensures token is present in signature)
    const creds = await s3.config.credentials();
    const post = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['starts-with', '$Content-Type', contentType.split('/')[0] + '/']
      ],
      Fields: {
        'Content-Type': contentType,
        'x-amz-server-side-encryption': 'AES256'
      },
      Expires: expiresSeconds
    });

    // ⚡ Inject session token if it exists (SDK sometimes omits it)
    if ((creds as any)?.sessionToken) {
      post.fields['x-amz-security-token'] = (creds as any).sessionToken;
    }

    return post;
  } catch (err) {
    console.error('makePresignedPost error:', err);
    throw new Error('Failed to generate presign');
  }
}

export async function headObject(bucket: string, key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}
