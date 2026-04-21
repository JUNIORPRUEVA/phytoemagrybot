import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class VoiceService {
  async generateVoice(
    text: string,
    apiKey: string,
    voiceId?: string,
    baseUrl = 'https://api.elevenlabs.io',
  ): Promise<Buffer> {
    if (!text.trim()) {
      throw new HttpException('Voice text is required', HttpStatus.BAD_REQUEST);
    }

    if (!apiKey) {
      throw new HttpException('ElevenLabs API key is required', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (!voiceId) {
      throw new HttpException('ElevenLabs voiceId is required', HttpStatus.INTERNAL_SERVER_ERROR);
    }

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
}