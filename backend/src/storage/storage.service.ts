import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { StoredFileResult, UploadableStorageFile } from './storage.types';

@Injectable()
export class StorageService {
  private client: S3Client | null = null;

  constructor(private readonly configService: ConfigService) {}

  async uploadFile(file: UploadableStorageFile): Promise<StoredFileResult> {
    const key = this.buildObjectKey(file.originalname);

    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.getBucketName(),
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return {
      key,
      publicUrl: this.buildPublicUrl(key),
      contentType: file.mimetype,
    };
  }

  async deleteFile(fileUrl: string): Promise<void> {
    const key = this.extractObjectKey(fileUrl);

    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: this.getBucketName(),
        Key: key,
      }),
    );
  }

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: this.getRequiredConfig('STORAGE_ENDPOINT'),
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.getRequiredConfig('STORAGE_ACCESS_KEY'),
          secretAccessKey: this.getRequiredConfig('STORAGE_SECRET_KEY'),
        },
      });
    }

    return this.client;
  }

  private buildObjectKey(originalName: string): string {
    const sanitizedName = originalName.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const safeName = sanitizedName.length > 0 ? sanitizedName : 'file.bin';
    return `media/${Date.now()}-${randomUUID()}-${safeName}`;
  }

  private buildPublicUrl(key: string): string {
    const endpoint = this.getRequiredConfig('STORAGE_ENDPOINT').replace(/\/+$/, '');
    const bucket = this.getBucketName();
    return `${endpoint}/${bucket}/${this.encodeObjectKey(key)}`;
  }

  private extractObjectKey(fileUrl: string): string {
    try {
      const url = new URL(fileUrl);
      const bucket = this.getBucketName();
      const normalizedPath = url.pathname.replace(/^\/+/, '');

      if (normalizedPath.startsWith(`${bucket}/`)) {
        return decodeURIComponent(normalizedPath.slice(bucket.length + 1));
      }

      if (normalizedPath.length > 0) {
        return decodeURIComponent(normalizedPath);
      }
    } catch {
      throw new BadRequestException('No fue posible interpretar la URL del archivo.');
    }

    throw new BadRequestException('No fue posible determinar el archivo a eliminar.');
  }

  private encodeObjectKey(key: string): string {
    return key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private getBucketName(): string {
    return this.getRequiredConfig('STORAGE_BUCKET');
  }

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) {
      throw new InternalServerErrorException(`Missing required environment variable ${name}`);
    }

    return value;
  }
}