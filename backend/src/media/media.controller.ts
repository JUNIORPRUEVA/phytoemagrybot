import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseFilePipeBuilder,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadableStorageFile } from '../storage/storage.types';
import { ALLOWED_MEDIA_MIME_PATTERN, MAX_MEDIA_FILE_SIZE } from './media.constants';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaService } from './media.service';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_MEDIA_FILE_SIZE,
      },
    }),
  )
  upload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_MEDIA_MIME_PATTERN })
        .addMaxSizeValidator({ maxSize: MAX_MEDIA_FILE_SIZE })
        .build({ fileIsRequired: true }),
    )
    file: UploadableStorageFile,
    @Body() dto: UploadMediaDto,
  ) {
    return this.mediaService.createMedia(file, dto, req.user!.activeCompanyId);
  }

  @Get()
  getAll(@Req() req: AuthenticatedRequest) {
    return this.mediaService.getAllMedia(req.user!.activeCompanyId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.mediaService.deleteMedia(id);
  }
}