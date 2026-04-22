import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { StoredFileResult, UploadableStorageFile } from './storage.types';

@Injectable()
export class StorageService {
  private client: S3Client | null = null;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {}

  async uploadFile(file: UploadableStorageFile): Promise<StoredFileResult> {
    const key = this.buildObjectKey(file.originalname);

    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.getBucketName(),
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      this.handleStorageError(error, 'upload');
    }

    return {
      key,
      publicUrl: this.buildPublicUrl(key),
      contentType: file.mimetype,
    };
  }

  async deleteFile(fileUrl: string): Promise<void> {
    const key = this.extractObjectKey(fileUrl);

    try {
      await this.getClient().send(
        new DeleteObjectCommand({
          Bucket: this.getBucketName(),
          Key: key,
        }),
      );
    } catch (error) {
      this.handleStorageError(error, 'delete');
    }
  }

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: this.configService.get<string>('STORAGE_REGION')?.trim() || 'auto',
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
    const publicUrl = this.configService.get<string>('STORAGE_PUBLIC_URL')?.trim();
    const baseUrl = (publicUrl || this.getRequiredConfig('STORAGE_ENDPOINT')).replace(/\/+$/, '');
    const bucket = this.getBucketName();
    const encodedKey = this.encodeObjectKey(key);

    const candidate = publicUrl
      ? `${baseUrl}/${encodedKey}`
      : `${baseUrl}/${bucket}/${encodedKey}`;

    this.ensureAbsoluteUrl(candidate);
    return candidate;
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

  private ensureAbsoluteUrl(value: string): void {
    try {
      const url = new URL(value);
      if (!url.protocol.startsWith('http')) {
        throw new Error('Invalid protocol');
      }
    } catch {
      throw new InternalServerErrorException('La URL publica generada para storage no es valida.');
    }
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

  private handleStorageError(error: unknown, operation: 'upload' | 'delete'): never {
    const message = error instanceof Error ? error.message : 'Unknown storage error';

    this.logger.error(
      `Storage ${operation} failed: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );

    if (this.isSignatureMismatchError(error)) {
      throw new InternalServerErrorException(
        'Las credenciales de Cloudflare R2 no son validas. Revisa STORAGE_ENDPOINT, STORAGE_ACCESS_KEY y STORAGE_SECRET_KEY.',
      );
    }

    throw new InternalServerErrorException(
      `No fue posible ${operation === 'upload' ? 'subir' : 'eliminar'} el archivo en storage.`,
    );
  }

  private isSignatureMismatchError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const candidate = error as { name?: string; Code?: string; message?: string };
    const message = candidate.message?.toLowerCase() ?? '';

    return (
      candidate.name === 'SignatureDoesNotMatch' ||
      candidate.Code === 'SignatureDoesNotMatch' ||
      message.includes('signaturedoesnotmatch') ||
      message.includes('request signature we calculated does not match')
    );
  }
}