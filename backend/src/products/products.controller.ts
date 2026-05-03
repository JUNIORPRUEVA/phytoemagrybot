import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { StorageService } from '../storage/storage.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.productsService.findAll(req.user!.activeCompanyId);
  }

  @Get('active')
  findActive(@Req() req: AuthenticatedRequest) {
    return this.productsService.findActive(req.user!.activeCompanyId);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(req.user!.activeCompanyId, id);
  }

  @Post('upload-media')
  @UseInterceptors(
    FilesInterceptor('files', 10, { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  async uploadMedia(
    @UploadedFiles() files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
  ): Promise<{ urls: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }
    const results = await Promise.all(
      files.map((f) =>
        this.storageService.uploadFile({
          buffer: f.buffer,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        }),
      ),
    );
    return { urls: results.map((r) => r.publicUrl) };
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateProductDto) {
    return this.productsService.create(req.user!.activeCompanyId, dto);
  }

  @Put(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(req.user!.activeCompanyId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.remove(req.user!.activeCompanyId, id);
  }
}
