import { Body, Controller, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';

type TrackKind = 'critical_error' | 'parsing_progress' | 'parsing_result_edit';

interface TrackDto {
  kind: TrackKind;
  text: string;
  // For edits
  messageId?: number;
  parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  disablePreview?: boolean;
}

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('track')
  async track(@Body() dto: TrackDto) {
    const parse_mode = dto.parseMode;
    const disable_web_page_preview = dto.disablePreview;

    if (dto.kind === 'parsing_result_edit' && dto.messageId) {
      return this.telegram.editMessage(dto.messageId, dto.text, {
        parse_mode,
        disable_web_page_preview,
      });
    }

    // For both critical errors and progress we send a new message
    return this.telegram.sendMessage(dto.text, {
      parse_mode,
      disable_web_page_preview,
    });
  }
}
