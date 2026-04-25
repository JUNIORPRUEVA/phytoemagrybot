import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import axios from 'axios';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { spawn } from 'node:child_process';

export interface GeneratedVoiceAudio {
  buffer: Buffer;
  fileName: string;
  mimetype: string;
  provider?: 'elevenlabs' | 'openai';
  sourceMimetype?: string;
}

export interface PrepareSpokenReplyParams {
  text: string;
  openAiKey?: string;
}

export interface ProbeAudioDurationParams {
  buffer: Buffer;
  mimetype?: string;
  fileName?: string;
}

@Injectable()
export class VoiceService {
  async getDurationSeconds(params: ProbeAudioDurationParams): Promise<number> {
    if (!Buffer.isBuffer(params.buffer) || params.buffer.length === 0) {
      throw new HttpException('Audio buffer is required', HttpStatus.BAD_REQUEST);
    }

    const mimetype = params.mimetype?.toLowerCase() ?? '';
    const isOgg = mimetype.includes('audio/ogg') || (params.fileName ?? '').toLowerCase().endsWith('.ogg');

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
    ];

    if (isOgg) {
      args.push('-f', 'ogg');
    }

    args.push('-i', 'pipe:0');

    return new Promise<number>((resolve, reject) => {
      const process = spawn('ffprobe', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      process.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      process.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      process.on('error', (error) => {
        reject(new HttpException(`ffprobe failed: ${error.message}`, HttpStatus.BAD_GATEWAY));
      });

      process.on('close', (code) => {
        if (code !== 0) {
          const details = Buffer.concat(stderrChunks).toString('utf8').trim();
          reject(
            new HttpException(
              `ffprobe failed (code ${code ?? 'unknown'}): ${details || 'unknown error'}`,
              HttpStatus.BAD_GATEWAY,
            ),
          );
          return;
        }

        const raw = Buffer.concat(stdoutChunks).toString('utf8').trim();
        const duration = Number.parseFloat(raw);
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new HttpException(`ffprobe returned invalid duration: ${raw || 'empty'}`, HttpStatus.BAD_GATEWAY));
          return;
        }

        resolve(duration);
      });

      process.stdin.end(params.buffer);
    });
  }

  async transcribeAudio(
    audio: Buffer,
    openAiKey: string,
    fileName = 'audio.ogg',
    mimeType = 'audio/ogg',
  ): Promise<string> {
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw new HttpException('Audio buffer is required', HttpStatus.BAD_REQUEST);
    }

    if (!openAiKey.trim()) {
      throw new HttpException('OpenAI API key is required', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const openai = new OpenAI({ apiKey: openAiKey });
      const file = await toFile(audio, fileName, { type: mimeType });
      const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'es',
        prompt: 'Transcribe en espanol latino, sin muletillas ni ruido.',
      });

      const text = this.normalizeTranscript(transcription.text);
      if (!text) {
        throw new HttpException('OpenAI returned an empty transcription', HttpStatus.BAD_GATEWAY);
      }

      return text;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException('Audio transcription failed', HttpStatus.BAD_GATEWAY);
    }
  }

  async generateVoice(params: {
    text: string;
    openAiKey?: string;
    elevenLabsKey?: string;
    voiceId?: string,
    baseUrl?: string,
  }): Promise<GeneratedVoiceAudio> {
    const text = params.text.trim();
    if (!text) {
      throw new HttpException('Voice text is required', HttpStatus.BAD_REQUEST);
    }

    const elevenLabsKey = params.elevenLabsKey?.trim();
    const voiceId = params.voiceId?.trim();
    const openAiKey = params.openAiKey?.trim();

    if (elevenLabsKey && voiceId) {
      const rawBuffer = await this.generateWithElevenLabs(
        text,
        elevenLabsKey,
        voiceId,
        params.baseUrl,
      );

      const oggBuffer = await this.convertMp3ToOggOpus(rawBuffer);

      return {
        buffer: oggBuffer,
        fileName: 'reply.ogg',
        mimetype: 'audio/ogg; codecs=opus',
        provider: 'elevenlabs',
        sourceMimetype: 'audio/mpeg',
      };
    }

    if (openAiKey) {
      const rawBuffer = await this.generateWithOpenAi(text, openAiKey);
      const oggBuffer = await this.convertMp3ToOggOpus(rawBuffer);
      return {
        buffer: oggBuffer,
        fileName: 'reply.ogg',
        mimetype: 'audio/ogg; codecs=opus',
        provider: 'openai',
        sourceMimetype: 'audio/mpeg',
      };
    }

    throw new HttpException(
      'No audio generation provider is configured',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  async prepareSpokenReply(params: PrepareSpokenReplyParams): Promise<string> {
    const normalized = this.normalizeSpokenText(params.text);
    const openAiKey = params.openAiKey?.trim();

    if (!normalized) {
      throw new HttpException('Voice text is required', HttpStatus.BAD_REQUEST);
    }

    if (!openAiKey) {
      return normalized;
    }

    try {
      const openai = new OpenAI({ apiKey: openAiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_completion_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'Convierte el texto a una version hablada para una nota de voz de WhatsApp. Debe sonar natural, cercana, humana, comercial y con un tono dominicano suave, sin sonar robotica. Mantener el mismo significado. Si encaja de forma natural, puede usar expresiones cercanas como mira, oye, tranquilo o bro, pero sin exagerar. Usa una sola idea corta o dos ideas breves. No uses emojis, listas, ni comillas. Devuelve solo texto plano.',
          },
          {
            role: 'user',
            content: normalized,
          },
        ],
      });

      const rewritten = completion.choices[0]?.message?.content?.trim() || '';
      return this.normalizeSpokenText(rewritten || normalized);
    } catch {
      return normalized;
    }
  }

  private async generateWithElevenLabs(
    text: string,
    apiKey: string,
    voiceId: string,
    baseUrl = 'https://api.elevenlabs.io',
  ): Promise<Buffer> {
    const response = await axios.post(
      `${baseUrl.replace(/\/$/, '')}/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
        },
      },
      {
        headers: {
          'xi-api-key': apiKey,
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 45000,
      },
    );

    return Buffer.from(response.data);
  }

  private async generateWithOpenAi(text: string, openAiKey: string): Promise<Buffer> {
    try {
      const openai = new OpenAI({ apiKey: openAiKey });
      const response = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: text,
      });

      return Buffer.from(await response.arrayBuffer());
    } catch {
      throw new HttpException('Audio generation failed', HttpStatus.BAD_GATEWAY);
    }
  }

  private async convertMp3ToOggOpus(input: Buffer): Promise<Buffer> {
    if (!Buffer.isBuffer(input) || input.length === 0) {
      throw new HttpException('Audio conversion input is required', HttpStatus.BAD_REQUEST);
    }

    return new Promise<Buffer>((resolve, reject) => {
      const process = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-c:a',
          'libopus',
          '-b:a',
          '128k',
          '-f',
          'ogg',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      process.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      process.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      process.on('error', (error) => {
        reject(new HttpException(`ffmpeg conversion failed: ${error.message}`, HttpStatus.BAD_GATEWAY));
      });

      process.on('close', (code) => {
        if (code === 0) {
          const output = Buffer.concat(stdoutChunks);
          if (output.length === 0) {
            reject(new HttpException('ffmpeg returned empty audio output', HttpStatus.BAD_GATEWAY));
            return;
          }
          resolve(output);
          return;
        }

        const details = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(
          new HttpException(
            `ffmpeg conversion failed (code ${code ?? 'unknown'}): ${details || 'unknown error'}`,
            HttpStatus.BAD_GATEWAY,
          ),
        );
      });

      process.stdin.end(input);
    });
  }

  private normalizeTranscript(value: string): string {
    const normalized = value
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!/[A-Za-z0-9ÁÉÍÓÚáéíóúÑñ]/.test(normalized)) {
      return '';
    }

    return normalized;
  }

  private normalizeSpokenText(value: string): string {
    const withoutEmoji = value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');
    const normalized = withoutEmoji
      .replace(/[“”"']/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return '';
    }

    const limitedSentences = normalized
      .split(/(?<=[.!?])\s+/)
      .filter((part) => part.trim().length > 0)
      .slice(0, 2)
      .join(' ')
      .trim();

    const words = limitedSentences.split(/\s+/).filter((word) => word.length > 0);
    const compact = words.length > 40 ? words.slice(0, 40).join(' ') : limitedSentences;

    return /[.!?]$/.test(compact) ? compact : `${compact}.`;
  }
}