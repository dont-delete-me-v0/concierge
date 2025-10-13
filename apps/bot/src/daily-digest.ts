#!/usr/bin/env node
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { DatabaseService } from './database.service.js';
import { EventsApiService } from './events-api.service.js';
import { formatEventCard } from './keyboards.js';
import { UserService } from './user.service.js';

interface DigestResult {
  sent: number;
  failed: number;
  noPreferences: number;
  noEvents: number;
}

async function sendDailyDigest(): Promise<DigestResult> {
  const result: DigestResult = {
    sent: 0,
    failed: 0,
    noPreferences: 0,
    noEvents: 0,
  };

  console.log('[DailyDigest] Starting daily digest...');

  // Инициализация сервисов
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
  const dbService = new DatabaseService();
  const userService = new UserService(dbService);
  const eventsApi = new EventsApiService();

  try {
    // Подключение к БД
    await dbService.onModuleInit();
    console.log('[DailyDigest] Database connected');

    // Получаем всех пользователей с предпочтениями
    const usersWithPrefs = await userService.getAllUsersWithPreferences();
    console.log(
      `[DailyDigest] Found ${usersWithPrefs.length} users with preferences`
    );

    if (usersWithPrefs.length === 0) {
      console.log('[DailyDigest] No users with preferences found');
      return result;
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
          result.noPreferences++;
          continue;
        }

        // Формируем параметры поиска
        const searchParams: any = {
          dateFrom: today,
          dateTo: nextWeek,
          limit: 10,
          offset: 0,
        };

        if (preferences.category_ids?.length) {
          searchParams.categoryId = preferences.category_ids[0];
        }

        if (preferences.price_min) {
          searchParams.priceFrom = preferences.price_min;
        }

        if (preferences.price_max) {
          searchParams.priceTo = preferences.price_max;
        }

        // Ищем события
        const { items: events, total } = await eventsApi.search(searchParams);

        if (!events.length) {
          result.noEvents++;
          // Можно отправить сообщение, что нет событий
          // await bot.telegram.sendMessage(
          //   user.telegram_id,
          //   '🎯 Сегодня нет новых мероприятий по вашим предпочтениям.'
          // );
          continue;
        }

        // Формируем сообщение
        const eventsList = events
          .slice(0, 5)
          .map((event, idx) => {
            const title = event.title || 'Без названия';
            const price = event.price_from ? `${event.price_from} грн` : '—';
            const dateFrom = event.date_time_from || event.date_time;
            const date = dateFrom
              ? new Date(dateFrom).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                })
              : 'Дата не указана';

            return `${idx + 1}. <b>${title}</b>\n   📅 ${date} | 💸 ${price}`;
          })
          .join('\n\n');

        const message = `🌅 <b>Доброе утро!</b>

🎯 <b>Подборка мероприятий для вас</b>

Нашли ${total} мероприятий по вашим предпочтениям на ближайшую неделю:

${eventsList}

${total > 5 ? `\n... и ещё ${total - 5} мероприятий\n` : ''}
🔍 Откройте бота и нажмите "🎯 Подборка для меня" для полного списка!`;

        // Отправляем сообщение
        await bot.telegram.sendMessage(user.telegram_id, message, {
          parse_mode: 'HTML',
        });

        result.sent++;
        console.log(
          `[DailyDigest] Sent to ${user.name || user.telegram_id} (${events.length} events)`
        );

        // Задержка между отправками (избежать rate limits)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        result.failed++;
        console.error(
          `[DailyDigest] Failed to send to ${user.telegram_id}:`,
          error.message
        );
      }
    }

    console.log('[DailyDigest] Digest completed:', result);
  } catch (error) {
    console.error('[DailyDigest] Error:', error);
  } finally {
    // Закрываем соединение с БД
    await dbService.onModuleDestroy();
    // Примечание: bot.stop() не нужен, так как бот не запускался через bot.launch()
    // Мы используем только bot.telegram.sendMessage(), который не требует запуска бота
  }

  return result;
}

// Запуск скрипта
sendDailyDigest()
  .then(result => {
    console.log('[DailyDigest] Final result:', result);
    process.exit(0);
  })
  .catch(error => {
    console.error('[DailyDigest] Fatal error:', error);
    process.exit(1);
  });
