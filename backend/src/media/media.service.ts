import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaFile, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadableStorageFile } from '../storage/storage.types';
import { ALLOWED_MEDIA_MIME_PATTERN } from './media.constants';
import { UploadMediaDto } from './dto/upload-media.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async createMedia(file: UploadableStorageFile, dto: UploadMediaDto): Promise<MediaFile> {
    this.validateFileType(file.mimetype);

    const uploaded = await this.storageService.uploadFile(file);

    return this.prisma.mediaFile.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        fileUrl: uploaded.publicUrl,
        fileType: this.resolveFileType(file.mimetype),
      },
    });
  }

  async getAllMedia(): Promise<MediaFile[]> {
    return this.prisma.mediaFile.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteMedia(id: number): Promise<MediaFile> {
    const media = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!media) {
      throw new NotFoundException('Archivo no encontrado.');
    }

    await this.storageService.deleteFile(media.fileUrl);

    return this.prisma.mediaFile.delete({ where: { id } });
  }

  async getMediaByKeyword(text: string, take = 3): Promise<MediaFile[]> {
    const normalizedText = text.trim().toLowerCase();
    if (!normalizedText) {
      return [];
    }

    if (this.looksLikeCatalogRequest(normalizedText)) {
      return this.prisma.mediaFile.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.max(take, 5),
      });
    }

    const tokens = Array.from(
      new Set(
        normalizedText
          .split(/[^a-zA-Z0-9áéíóúñü]+/)
          .map((token) => token.trim())
          .filter((token) => token.length >= 3),
      ),
    ).slice(0, 8);

    const orConditions: Prisma.MediaFileWhereInput[] = [
      {
        title: {
          contains: normalizedText,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      {
        description: {
          contains: normalizedText,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      ...tokens.flatMap((token) => [
        {
          title: {
            contains: token,
            mode: Prisma.QueryMode.insensitive,
          },
        },
        {
          description: {
            contains: token,
            mode: Prisma.QueryMode.insensitive,
          },
        },
      ]),
    ];

    const matches = await this.prisma.mediaFile.findMany({
      where: { OR: orConditions },
      orderBy: { createdAt: 'desc' },
      take,
    });

    if (matches.length > 0) {
      return matches;
    }

    if (this.looksLikePriceRequest(normalizedText)) {
      return this.prisma.mediaFile.findMany({
        where: { fileType: 'image' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
    }

    return matches;
  }

  private looksLikeCatalogRequest(text: string): boolean {
    return ['catalogo', 'catálogo', 'catalog'].some((keyword) => text.includes(keyword));
  }

  private looksLikePriceRequest(text: string): boolean {
    return ['precio', 'cuesta', 'vale', 'coste'].some((keyword) => text.includes(keyword));
  }

  private validateFileType(mimetype: string): void {
    if (!ALLOWED_MEDIA_MIME_PATTERN.test(mimetype)) {
      throw new BadRequestException('Solo se permiten archivos de imagen o video.');
    }
  }

  private resolveFileType(mimetype: string): 'image' | 'video' {
    return mimetype.toLowerCase().startsWith('video/') ? 'video' : 'image';
  }
}