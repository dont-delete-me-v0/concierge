import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import * as cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { EventsApiService } from './events-api.service';
import { UserService } from './user.service';

interface DigestStats {
  sent: number;
  failed: number;
  noPreferences: number;
  noEvents: number;
}

@Injectable()
export class DigestService implements OnModuleInit {
  private readonly logger = new Logger(DigestService.name);
  private cronJob: cron.ScheduledTask | null = null;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly userService: UserService,
    private readonly eventsApi: EventsApiService
  ) {}

  onModuleInit() {
    // Запускаем cron задачу при старте приложения
    // Формат: секунды минуты часы день месяц день_недели
    // 0 8 * * * = каждый день в 8:00 UTC (10:00 Kiev time)
    const cronExpression = process.env.DIGEST_CRON || '0 8 * * *';

    this.logger.log(`Starting digest scheduler with cron: ${cronExpression}`);

    this.cronJob = cron.schedule(
      cronExpression,
      async () => {
        this.logger.log('Running scheduled daily digest...');
        await this.sendDailyDigest();
      },
      {
        timezone: 'Europe/Kiev', // Kiev time zone
      }
    );

    this.logger.log('Digest scheduler started successfully');
  }

  /**
   * Отправить ежедневную рассылку
   */
  async sendDailyDigest(): Promise<DigestStats> {
    const stats: DigestStats = {
      sent: 0,
      failed: 0,
      noPreferences: 0,
      noEvents: 0,
    };

    this.logger.log('Starting daily digest...');

    try {
      // Получаем всех пользователей с предпочтениями
      const usersWithPrefs =
        await this.userService.getAllUsersWithPreferences();
      this.logger.log(`Found ${usersWithPrefs.length} users with preferences`);

      if (usersWithPrefs.length === 0) {
        this.logger.log('No users with preferences found');
        return stats;
      }

      // Формируем даты для поиска (сегодня + неделя)
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      // Отправляем подборку каждому пользователю
      for (const { user, preferences } of usersWithPrefs) {
        try {
          // Проверяем, есть ли предпочтения
          if (
            !preferences.category_ids?.length &&
            !preferences.price_min &&
            !preferences.price_max
          ) {
            stats.noPreferences++;
            continue;
          }

          // Формируем параметры поиска
          const searchParams: any = {
            dateFrom: today,
            dateTo: nextWeek,
          };

          if (preferences.category_ids?.length) {
            // Передаем все категории из предпочтений
            searchParams.categoryId = preferences.category_ids;
          }

          if (preferences.price_min) {
            searchParams.priceFrom = preferences.price_min;
          }

          if (preferences.price_max) {
            searchParams.priceTo = preferences.price_max;
          }

          // Получаем только первые 5 событий для показа + total для подсчета
          const { items: events, total } = await this.eventsApi.search({
            ...searchParams,
            limit: 5,
            offset: 0,
          });

          if (!events.length) {
            stats.noEvents++;
            // Опционально: отправить сообщение, что нет событий
            // await this.bot.telegram.sendMessage(
            //   user.telegram_id,
            //   '🎯 Сегодня нет новых мероприятий по вашим предпочтениям.'
            // );
            continue;
          }

          this.logger.log(
            `Loaded ${events.length} events for display, total: ${total}`
          );

          // Формируем сообщение
          const eventsList = events
            .map((event, idx) => {
              const title = event.title || 'Без названия';

              // Format price range
              let price = '—';
              if (event.price_from != null && event.price_to != null && event.price_from !== event.price_to) {
                price = `${event.price_from}-${event.price_to} грн`;
              } else if (event.price_from != null) {
                price = `від ${event.price_from} грн`;
              }

              const dateFrom = event.date_time_from || event.date_time;
              const date = dateFrom
                ? new Date(dateFrom).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                  })
                : 'Дата не указана';

              return `${idx + 1}. <b>${this.escapeHtml(title)}</b>\n   📅 ${date} | 💸 ${price}`;
            })
            .join('\n\n');

          const message = `🌅 <b>Доброе утро!</b>

🎯 <b>Подборка мероприятий для вас</b>

Нашли ${total} мероприятий по вашим предпочтениям на ближайшую неделю:

${eventsList}

${total > 5 ? `\n... и ещё ${total - 5} мероприятий\n` : ''}
🔍 Откройте бота и нажмите "🎯 Подборка для меня" для полного списка!`;

          // Отправляем сообщение
          await this.bot.telegram.sendMessage(user.telegram_id, message, {
            parse_mode: 'HTML',
          });

          stats.sent++;
          this.logger.log(
            `Sent to ${user.name || user.telegram_id} (${total} events, showing top 5)`
          );

          // Задержка между отправками (избежать rate limits)
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          stats.failed++;
          this.logger.error(
            `Failed to send to ${user.telegram_id}:`,
            error.message
          );
        }
      }

      this.logger.log('Digest completed:', stats);
    } catch (error) {
      this.logger.error('Error during digest:', error);
    }

    return stats;
  }

  /**
   * Escape HTML специальных символов
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Остановить планировщик
   */
  onModuleDestroy() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.logger.log('Digest scheduler stopped');
    }
  }
}
