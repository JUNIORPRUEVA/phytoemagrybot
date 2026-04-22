import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadableStorageFile } from '../storage/storage.types';
import { ALLOWED_MEDIA_MIME_PATTERN, MAX_MEDIA_FILE_SIZE } from './media.constants';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaService } from './media.service';

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
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_MEDIA_MIME_PATTERN })
        .addMaxSizeValidator({ maxSize: MAX_MEDIA_FILE_SIZE })
        .build({ fileIsRequired: true }),
    )
    file: UploadableStorageFile,
    @Body() dto: UploadMediaDto,
  ) {
    return this.mediaService.createMedia(file, dto);
  }

  @Get()
  getAll() {
    return this.mediaService.getAllMedia();
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.mediaService.deleteMedia(id);
  }
}