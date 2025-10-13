import { Ctx, Hears, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import type { Context, Scenes } from 'telegraf';
import { Markup } from 'telegraf';
import { EventsApiService } from './events-api.service.js';
import { formatEventCard, mainKeyboard, resolveEventUrl } from './keyboards.js';
import { UserService } from './user.service.js';

export interface SessionData {
  selectedCategories?: string[];
  events?: import('./events-api.service.js').EventItem[];
  currentIndex?: number;
  view?: 'card' | 'list';
  searchMode?: 'name' | 'price' | 'venue' | null;
  searchParams?: any; // Last search params for lazy loading
  totalEvents?: number; // Total count from server
  searchToken?: string; // isolates pagination callbacks per search
  profileEditMode?: 'phone' | 'email' | 'price' | 'categories' | null; // Current profile edit mode
  tempCategorySelection?: string[]; // Temporary category selection for preferences
  categoriesList?: Array<{ id: string; name: string }>; // Categories list for profile editing
}

export type BotContext = Context &
  Scenes.WizardContext & { session: SessionData };

@Update()
export class BotUpdate {
  constructor(
    private readonly eventsApi: EventsApiService,
    private readonly userService: UserService,
    @InjectBot() private readonly bot: any
  ) {}

  private generateSearchToken(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * Получить все события с пагинацией
   */
  private async getAllEventsWithPagination(searchParams: any): Promise<{
    events: import('./events-api.service.js').EventItem[];
    total: number;
  }> {
    const allEvents: import('./events-api.service.js').EventItem[] = [];
    let offset = 0;
    const limit = 50;
    let totalCount = 0;

    console.log('[BotUpdate] Starting pagination with params:', searchParams);

    while (true) {
      const { items, total } = await this.eventsApi.search({
        ...searchParams,
        limit,
        offset,
      });

      console.log(
        `[BotUpdate] Page fetched: offset=${offset}, items=${items.length}, total=${total}`
      );

      allEvents.push(...items);
      totalCount = total;
      offset += limit;

      // Проверяем, есть ли еще события
      const hasMore = allEvents.length < total && items.length === limit;
      console.log(
        `[BotUpdate] hasMore=${hasMore} (collected=${allEvents.length}, total=${total}, lastPageSize=${items.length})`
      );

      if (!hasMore) break;

      // Защита от бесконечного цикла
      if (offset > 1000) {
        console.warn('[BotUpdate] Reached maximum offset limit (1000)');
        break;
      }
    }

    console.log(
      `[BotUpdate] Pagination complete: collected ${allEvents.length} events`
    );
    return { events: allEvents, total: totalCount };
  }

  @Start()
  async onStart(@Ctx() ctx: BotContext) {
    // Автоматическая регистрация пользователя
    const telegramId = String(ctx.from?.id || '');
    const name = ctx.from?.first_name
      ? `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`
      : undefined;

    if (telegramId) {
      await this.userService.registerOrGetUser(telegramId, name);
    }

    await ctx.reply(
      'Привет! Я помогу найти мероприятия. Выберите действие ниже.',
      mainKeyboard()
    );
  }

  @Hears('🔍 Поиск')
  async onSearchMenu(@Ctx() ctx: BotContext) {
    await ctx.reply(
      'Выберите тип поиска:',
      Markup.keyboard([
        ['По названию', 'По адресу'],
        ['По категории', 'По дате'],
        ['По цене'],
        ['⬅️ Назад'],
      ]).resize()
    );
  }

  @Hears('⬅️ Назад')
  async onBack(@Ctx() ctx: BotContext) {
    ctx.session.searchMode = null;
    await ctx.reply('Главное меню:', mainKeyboard());
  }

  @Hears('По названию')
  async onSearchByName(@Ctx() ctx: BotContext) {
    ctx.session.searchMode = 'name';
    await ctx.reply('Введите часть названия мероприятия:');
  }

  @Hears('По адресу')
  async onSearchByVenue(@Ctx() ctx: BotContext) {
    ctx.session.searchMode = 'venue';
    await ctx.reply('Введите часть названия площадки (адрес/venue name):');
  }

  @Hears('По дате')
  async onSearchByDate(@Ctx() ctx: BotContext) {
    const token = this.generateSearchToken();
    ctx.session.searchToken = token;
    await ctx.reply(
      'Выберите период:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Сегодня', `s:${token}:d:today`)],
        [Markup.button.callback('Завтра', `s:${token}:d:tomorrow`)],
        [Markup.button.callback('7 дней', `s:${token}:d:week`)],
        [Markup.button.callback('Ввести вручную', `s:${token}:d:manual`)],
      ])
    );
  }

  @Hears('По категории')
  async onSearchByCategory(@Ctx() ctx: BotContext) {
    const cats = await this.eventsApi.categories();
    if (!cats.length) {
      await ctx.reply('Категории не найдены');
      return;
    }
    const searchToken = this.generateSearchToken();
    ctx.session.searchToken = searchToken;
    // Chunk categories into rows of 2-3 buttons
    const rows: any[] = [];
    const tokens: string[] = [];
    for (const c of cats) {
      const token = this.eventsApi.tokenForEventId(c.id);
      tokens.push(token);
    }
    for (let i = 0; i < cats.length; i += 3) {
      rows.push(
        cats
          .slice(i, i + 3)
          .map((c, j) =>
            Markup.button.callback(
              c.name,
              `s:${searchToken}:c:${tokens[i + j]}`
            )
          )
      );
    }
    await ctx.reply('Выберите категорию:', Markup.inlineKeyboard(rows));
  }

  @Hears('По цене')
  async onSearchByPrice(@Ctx() ctx: BotContext) {
    ctx.session.searchMode = 'price';
    await ctx.reply(
      'Введите диапазон цен в формате:\n- 100-500 (от 100 до 500 грн)\n- 200 (от 200 грн)\n- -300 (до 300 грн)'
    );
  }

  @Hears('⭐️ Избранное')
  async onFavorites(@Ctx() ctx: BotContext) {
    const telegramId = String(ctx.from?.id || '');
    if (!telegramId) {
      await ctx.reply('Не удалось определить пользователя.');
      return;
    }

    const favoriteIds = await this.userService.getFavorites(telegramId);
    if (!favoriteIds.length) {
      await ctx.reply('У вас пока нет избранных мероприятий.');
      return;
    }

    // Загружаем полные данные о событиях
    const events: any[] = [];
    for (const id of favoriteIds) {
      const event = await this.eventsApi.getById(id);
      if (event) events.push(event);
    }

    if (!events.length) {
      await ctx.reply('Не удалось загрузить избранные мероприятия.');
      return;
    }

    ctx.session.events = events;
    ctx.session.totalEvents = events.length;
    ctx.session.searchParams = { favoriteIds }; // Сохраняем для возможной перезагрузки
    ctx.session.currentIndex = 0;
    ctx.session.view = 'card';
    ctx.session.searchToken = this.generateSearchToken();
    const first = events[0];
    await ctx.replyWithHTML(
      formatEventCard(first),
      await this.buildCardKeyboard(
        first,
        0,
        events.length,
        ctx.session.searchToken,
        ctx
      )
    );
  }

  @Hears('👤 Профиль')
  async onProfile(@Ctx() ctx: BotContext) {
    const telegramId = String(ctx.from?.id || '');
    if (!telegramId) {
      await ctx.reply('Не удалось определить пользователя.');
      return;
    }

    const user = await this.userService.getUserByTelegramId(telegramId);
    const preferences = await this.userService.getUserPreferences(telegramId);

    if (!user) {
      await ctx.reply(
        'Профиль не найден. Пожалуйста, начните с команды /start'
      );
      return;
    }

    // Форматируем информацию о профиле
    const profileLines = [
      '<b>👤 Ваш профиль</b>',
      '',
      `<b>Имя:</b> ${user.name || 'Не указано'}`,
      `<b>Телефон:</b> ${user.phone || 'Не указан'}`,
      `<b>Email:</b> ${user.email || 'Не указан'}`,
      `<b>Подписка:</b> ${user.subscription_type}`,
      '',
      '<b>⚙️ Предпочтения</b>',
    ];

    if (preferences) {
      if (preferences.category_ids && preferences.category_ids.length > 0) {
        // Получаем названия категорий
        const cats = await this.eventsApi.categories();
        const selectedCatNames = preferences.category_ids
          .map(id => cats.find(c => c.id === id)?.name)
          .filter(Boolean);
        profileLines.push(
          `<b>Категории:</b> ${selectedCatNames.join(', ') || 'Не выбраны'}`
        );
      } else {
        profileLines.push('<b>Категории:</b> Не выбраны');
      }

      if (preferences.price_min !== null || preferences.price_max !== null) {
        const priceRange: string[] = [];
        if (preferences.price_min)
          priceRange.push(`от ${preferences.price_min} грн`);
        if (preferences.price_max)
          priceRange.push(`до ${preferences.price_max} грн`);
        profileLines.push(
          `<b>Цены:</b> ${priceRange.join(' ') || 'Не указаны'}`
        );
      } else {
        profileLines.push('<b>Цены:</b> Не указаны');
      }
    } else {
      profileLines.push('Предпочтения не настроены');
    }

    const profileText = profileLines.join('\n');

    await ctx.replyWithHTML(
      profileText,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('📱 Изменить телефон', 'profile:edit:phone'),
          Markup.button.callback('📧 Изменить email', 'profile:edit:email'),
        ],
        [Markup.button.callback('⚙️ Предпочтения', 'profile:prefs:view')],
        [Markup.button.callback('🔄 Обновить', 'profile:refresh')],
      ])
    );
  }

  @Hears('⚡️ Что сегодня?')
  async onToday(@Ctx() ctx: BotContext) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const searchParams = {
      dateFrom: today,
      dateTo: today,
      limit: 10,
      offset: 0,
    };
    const { items: events, total } = await this.eventsApi.search(searchParams);
    if (!events.length) {
      await ctx.reply('На сегодня ничего не найдено.');
      return;
    }
    ctx.session.events = events;
    ctx.session.totalEvents = total;
    ctx.session.searchParams = searchParams;
    ctx.session.currentIndex = 0;
    ctx.session.view = 'card';
    ctx.session.searchToken = this.generateSearchToken();
    const first = events[0];
    await ctx.replyWithHTML(
      formatEventCard(first),
      await this.buildCardKeyboard(
        first,
        0,
        total,
        ctx.session.searchToken,
        ctx
      )
    );
  }

  @Hears('🎯 Подборка для меня')
  async onRecommendations(@Ctx() ctx: BotContext) {
    const telegramId = String(ctx.from?.id || '');

    // Получаем предпочтения пользователя
    const preferences = await this.userService.getUserPreferences(telegramId);

    if (
      !preferences ||
      (!preferences.category_ids?.length &&
        !preferences.price_min &&
        !preferences.price_max)
    ) {
      await ctx.reply(
        '🎯 Настройте ваши предпочтения в профиле для персональной подборки!\n\n' +
          'Перейдите в 👤 Профиль → ⚙️ Предпочтения и укажите:\n' +
          '• Интересующие категории\n' +
          '• Желаемый диапазон цен',
        mainKeyboard()
      );
      return;
    }

    // Формируем параметры поиска на основе предпочтений
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

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

    // Получаем все события с пагинацией
    const { events, total } =
      await this.getAllEventsWithPagination(searchParams);

    if (!events.length) {
      await ctx.reply(
        '🎯 К сожалению, не нашлось мероприятий по вашим предпочтениям.\n\n' +
          'Попробуйте расширить критерии поиска в профиле.',
        mainKeyboard()
      );
      return;
    }

    // Показываем подборку
    ctx.session.events = events;
    ctx.session.totalEvents = total;
    ctx.session.searchParams = searchParams;
    ctx.session.currentIndex = 0;
    ctx.session.view = 'card';
    ctx.session.searchToken = this.generateSearchToken();

    const first = events[0];
    const message = `🎯 <b>Подборка для вас</b>\n\nНайдено ${total} мероприятий по вашим предпочтениям:\n\n${formatEventCard(first)}`;

    await ctx.replyWithHTML(
      message,
      await this.buildCardKeyboard(
        first,
        0,
        total,
        ctx.session.searchToken,
        ctx
      )
    );
  }

  @On('callback_query')
  async onCallback(@Ctx() ctx: BotContext) {
    const data = String((ctx.callbackQuery as any)?.data ?? '');
    // Legacy details token
    if (data.startsWith('d:')) {
      const token = data.slice(2);
      const id = this.eventsApi.resolveEventId(token);
      if (!id) {
        await ctx.answerCbQuery('Ссылка устарела');
        return;
      }
      const event = await this.eventsApi.getById(id);
      if (!event) {
        await ctx.answerCbQuery('Мероприятие не найдено');
      } else {
        await ctx.replyWithHTML(formatEventCard(event));
        await ctx.answerCbQuery();
      }
      return;
    }

    // Tokenized callbacks to avoid cross-search interference
    let action = data;
    let args: string[] = [];
    if (data.startsWith('t:')) {
      const parts = data.split(':');
      const token = parts[1];
      if (!token || token !== (ctx.session.searchToken ?? '')) {
        await ctx.answerCbQuery('Сессия поиска устарела');
        return;
      }
      action = parts[2] ?? '';
      args = parts.slice(3);
    }

    if (action === 'noop') {
      await ctx.answerCbQuery();
      return;
    }

    // Profile actions
    if (data.startsWith('profile:')) {
      const parts = data.split(':');
      const profileAction = parts[1];
      const subAction = parts[2];

      if (profileAction === 'refresh') {
        // Refresh profile - call onProfile but edit message
        const telegramId = String(ctx.from?.id || '');
        const user = await this.userService.getUserByTelegramId(telegramId);
        const preferences =
          await this.userService.getUserPreferences(telegramId);

        if (!user) {
          await ctx.answerCbQuery('Профиль не найден');
          return;
        }

        const profileLines = [
          '<b>👤 Ваш профиль</b>',
          '',
          `<b>Имя:</b> ${user.name || 'Не указано'}`,
          `<b>Телефон:</b> ${user.phone || 'Не указан'}`,
          `<b>Email:</b> ${user.email || 'Не указан'}`,
          `<b>Подписка:</b> ${user.subscription_type}`,
          '',
          '<b>⚙️ Предпочтения</b>',
        ];

        if (preferences) {
          if (preferences.category_ids && preferences.category_ids.length > 0) {
            const cats = await this.eventsApi.categories();
            const selectedCatNames = preferences.category_ids
              .map(id => cats.find(c => c.id === id)?.name)
              .filter(Boolean);
            profileLines.push(
              `<b>Категории:</b> ${selectedCatNames.join(', ') || 'Не выбраны'}`
            );
          } else {
            profileLines.push('<b>Категории:</b> Не выбраны');
          }

          if (
            preferences.price_min !== null ||
            preferences.price_max !== null
          ) {
            const priceRange: string[] = [];
            if (preferences.price_min)
              priceRange.push(`от ${preferences.price_min} грн`);
            if (preferences.price_max)
              priceRange.push(`до ${preferences.price_max} грн`);
            profileLines.push(
              `<b>Цены:</b> ${priceRange.join(' ') || 'Не указаны'}`
            );
          } else {
            profileLines.push('<b>Цены:</b> Не указаны');
          }
        } else {
          profileLines.push('Предпочтения не настроены');
        }

        // Добавляем timestamp для избежания ошибки "message is not modified"
        const currentTime = new Date().toLocaleTimeString('ru-RU');
        profileLines.push('', `🔄 Обновлено: ${currentTime}`);

        try {
          await ctx.editMessageText(profileLines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '📱 Изменить телефон',
                    callback_data: 'profile:edit:phone',
                  },
                  {
                    text: '📧 Изменить email',
                    callback_data: 'profile:edit:email',
                  },
                ],
                [
                  {
                    text: '⚙️ Предпочтения',
                    callback_data: 'profile:prefs:view',
                  },
                ],
                [{ text: '🔄 Обновить', callback_data: 'profile:refresh' }],
              ],
            },
          });
          await ctx.answerCbQuery('Обновлено');
        } catch (error: any) {
          // Если сообщение не изменилось, просто показываем уведомление
          if (error.description?.includes('message is not modified')) {
            await ctx.answerCbQuery('Профиль уже актуален');
          } else {
            console.error('[Profile Refresh] Error:', error);
            await ctx.answerCbQuery('Ошибка при обновлении');
          }
        }
        return;
      }

      if (profileAction === 'prefs' && subAction === 'view') {
        // Показываем меню предпочтений
        const telegramId = String(ctx.from?.id || '');
        const preferences =
          await this.userService.getUserPreferences(telegramId);

        const prefsLines = ['<b>⚙️ Ваши предпочтения</b>', ''];

        if (preferences) {
          // Категории
          if (preferences.category_ids && preferences.category_ids.length > 0) {
            const cats = await this.eventsApi.categories();
            const selectedCatNames = preferences.category_ids
              .map(id => cats.find(c => c.id === id)?.name)
              .filter(Boolean);
            prefsLines.push(
              `<b>🎭 Категории:</b>\n${selectedCatNames.join(', ')}`
            );
          } else {
            prefsLines.push('<b>🎭 Категории:</b> Не выбраны');
          }

          prefsLines.push('');

          // Цены
          if (
            preferences.price_min !== null ||
            preferences.price_max !== null
          ) {
            const priceRange: string[] = [];
            if (preferences.price_min)
              priceRange.push(`от ${preferences.price_min} грн`);
            if (preferences.price_max)
              priceRange.push(`до ${preferences.price_max} грн`);
            prefsLines.push(`<b>💰 Цены:</b>\n${priceRange.join(' ')}`);
          } else {
            prefsLines.push('<b>💰 Цены:</b> Не указаны');
          }
        } else {
          prefsLines.push('Предпочтения не настроены');
        }

        try {
          await ctx.editMessageText(prefsLines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🎭 Изменить категории',
                    callback_data: 'profile:edit:categories',
                  },
                ],
                [
                  {
                    text: '💰 Изменить цены',
                    callback_data: 'profile:edit:price',
                  },
                ],
                [
                  {
                    text: '◀️ Назад к профилю',
                    callback_data: 'profile:refresh',
                  },
                ],
              ],
            },
          });
          await ctx.answerCbQuery();
        } catch (error: any) {
          // Если сообщение не изменилось, просто показываем уведомление
          if (error.description?.includes('message is not modified')) {
            await ctx.answerCbQuery('Предпочтения уже актуальны');
          } else {
            console.error('[Profile Prefs] Error:', error);
            await ctx.answerCbQuery('Ошибка при загрузке предпочтений');
          }
        }
        return;
      }

      if (profileAction === 'edit') {
        if (subAction === 'phone') {
          ctx.session.profileEditMode = 'phone';
          try {
            await ctx.editMessageText(
              'Введите ваш номер телефона в формате +380XXXXXXXXX:'
            );
            await ctx.answerCbQuery();
          } catch (error: any) {
            console.error('[Profile Edit Phone] Error:', error);
            await ctx.answerCbQuery('Ошибка при открытии редактора телефона');
          }
          return;
        }

        if (subAction === 'email') {
          ctx.session.profileEditMode = 'email';
          try {
            await ctx.editMessageText('Введите ваш email:');
            await ctx.answerCbQuery();
          } catch (error: any) {
            console.error('[Profile Edit Email] Error:', error);
            await ctx.answerCbQuery('Ошибка при открытии редактора email');
          }
          return;
        }

        if (subAction === 'price') {
          ctx.session.profileEditMode = 'price';
          try {
            await ctx.editMessageText(
              'Введите диапазон цен в формате:\n' +
                '- 100-500 (от 100 до 500 грн)\n' +
                '- 200 (от 200 грн)\n' +
                '- -300 (до 300 грн)\n' +
                '- 0 (сбросить)'
            );
            await ctx.answerCbQuery();
          } catch (error: any) {
            console.error('[Profile Edit Price] Error:', error);
            await ctx.answerCbQuery('Ошибка при открытии редактора цен');
          }
          return;
        }

        if (subAction === 'categories') {
          const cats = await this.eventsApi.categories();
          if (!cats.length) {
            await ctx.answerCbQuery('Категории не найдены');
            return;
          }

          const preferences = await this.userService.getUserPreferences(
            String(ctx.from?.id || '')
          );
          const selectedIds = preferences?.category_ids || [];
          ctx.session.tempCategorySelection = [...selectedIds];
          ctx.session.profileEditMode = 'categories';
          ctx.session.categoriesList = cats; // Сохраняем список категорий в сессии

          const rows: any[] = [];
          for (let i = 0; i < cats.length; i += 2) {
            const row: { text: string; callback_data: string }[] = [];
            for (let j = 0; j < 2 && i + j < cats.length; j++) {
              const catIndex = i + j;
              const cat = cats[catIndex];
              const isSelected = selectedIds.includes(cat.id);
              row.push({
                text: `${isSelected ? '✅' : '⬜'} ${cat.name}`,
                callback_data: `profile:toggle:cat:${catIndex}`, // Используем индекс вместо ID
              });
            }
            rows.push(row);
          }
          rows.push([
            { text: '💾 Сохранить', callback_data: 'profile:save:categories' },
          ]);
          rows.push([
            { text: '❌ Отмена', callback_data: 'profile:prefs:view' },
          ]);

          try {
            await ctx.editMessageText('Выберите интересующие категории:', {
              reply_markup: { inline_keyboard: rows },
            });
            await ctx.answerCbQuery();
          } catch (error: any) {
            console.error('[Profile Edit Categories] Error:', error);
            await ctx.answerCbQuery('Ошибка при открытии редактора категорий');
          }
          return;
        }
      }

      if (profileAction === 'toggle' && subAction === 'cat') {
        const catIndexStr = parts[3];
        const catIndex = parseInt(catIndexStr, 10);

        if (!ctx.session.categoriesList || isNaN(catIndex)) {
          await ctx.answerCbQuery('Ошибка: категория не найдена');
          return;
        }

        const cat = ctx.session.categoriesList[catIndex];
        if (!cat) {
          await ctx.answerCbQuery('Ошибка: категория не найдена');
          return;
        }

        if (!ctx.session.tempCategorySelection) {
          ctx.session.tempCategorySelection = [];
        }

        // Переключаем выбор категории по её ID
        const selectedIndex = ctx.session.tempCategorySelection.indexOf(cat.id);
        if (selectedIndex > -1) {
          ctx.session.tempCategorySelection.splice(selectedIndex, 1);
        } else {
          ctx.session.tempCategorySelection.push(cat.id);
        }

        // Update inline keyboard
        const cats = ctx.session.categoriesList;
        const selectedIds = ctx.session.tempCategorySelection;
        const rows: any[] = [];
        for (let i = 0; i < cats.length; i += 2) {
          const row: { text: string; callback_data: string }[] = [];
          for (let j = 0; j < 2 && i + j < cats.length; j++) {
            const idx = i + j;
            const category = cats[idx];
            const isSelected = selectedIds.includes(category.id);
            row.push({
              text: `${isSelected ? '✅' : '⬜'} ${category.name}`,
              callback_data: `profile:toggle:cat:${idx}`, // Используем индекс
            });
          }
          rows.push(row);
        }
        rows.push([
          { text: '💾 Сохранить', callback_data: 'profile:save:categories' },
        ]);
        rows.push([{ text: '❌ Отмена', callback_data: 'profile:prefs:view' }]);

        await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
        await ctx.answerCbQuery();
        return;
      }

      if (profileAction === 'save' && subAction === 'categories') {
        const telegramId = String(ctx.from?.id || '');
        const categoryIds = ctx.session.tempCategorySelection || [];

        const success = await this.userService.updateCategoryPreferences(
          telegramId,
          categoryIds
        );

        if (success) {
          ctx.session.profileEditMode = null;
          ctx.session.tempCategorySelection = undefined;
          ctx.session.categoriesList = undefined; // Очищаем список категорий

          try {
            await ctx.editMessageText(
              '✅ Предпочтения по категориям сохранены!'
            );
            await ctx.answerCbQuery();
          } catch (error: any) {
            console.error('[Category Save] Error:', error);
            await ctx.answerCbQuery('Предпочтения сохранены');
          }

          // Показываем обновленное меню предпочтений через секунду
          setTimeout(async () => {
            const preferences =
              await this.userService.getUserPreferences(telegramId);

            const prefsLines = ['<b>⚙️ Ваши предпочтения</b>', ''];

            if (preferences) {
              // Категории
              if (
                preferences.category_ids &&
                preferences.category_ids.length > 0
              ) {
                const cats = await this.eventsApi.categories();
                const selectedCatNames = preferences.category_ids
                  .map(id => cats.find(c => c.id === id)?.name)
                  .filter(Boolean);
                prefsLines.push(
                  `<b>🎭 Категории:</b>\n${selectedCatNames.join(', ')}`
                );
              } else {
                prefsLines.push('<b>🎭 Категории:</b> Не выбраны');
              }

              prefsLines.push('');

              // Цены
              if (
                preferences.price_min !== null ||
                preferences.price_max !== null
              ) {
                const priceRange: string[] = [];
                if (preferences.price_min)
                  priceRange.push(`от ${preferences.price_min} грн`);
                if (preferences.price_max)
                  priceRange.push(`до ${preferences.price_max} грн`);
                prefsLines.push(`<b>💰 Цены:</b>\n${priceRange.join(' ')}`);
              } else {
                prefsLines.push('<b>💰 Цены:</b> Не указаны');
              }
            } else {
              prefsLines.push('Предпочтения не настроены');
            }

            await ctx.replyWithHTML(
              prefsLines.join('\n'),
              Markup.inlineKeyboard([
                [
                  {
                    text: '🎭 Изменить категории',
                    callback_data: 'profile:edit:categories',
                  },
                ],
                [
                  {
                    text: '💰 Изменить цены',
                    callback_data: 'profile:edit:price',
                  },
                ],
                [
                  {
                    text: '◀️ Назад к профилю',
                    callback_data: 'profile:refresh',
                  },
                ],
              ])
            );
          }, 1000);
        } else {
          await ctx.answerCbQuery('Ошибка при сохранении');
        }
        return;
      }
    }

    // Favorites: add/remove
    if (action === 'fav' && (args[0] === 'add' || args[0] === 'remove')) {
      const telegramId = String(ctx.from?.id || '');
      const eventToken = args[1];

      if (!telegramId || !eventToken) {
        await ctx.answerCbQuery('Ошибка обработки');
        return;
      }

      // Разрешаем короткий токен обратно в полный ID события
      const eventId = this.eventsApi.resolveEventId(eventToken);
      if (!eventId) {
        await ctx.answerCbQuery('Событие не найдено');
        return;
      }

      if (args[0] === 'add') {
        const success = await this.userService.addFavorite(telegramId, eventId);
        if (success) {
          await ctx.answerCbQuery('✅ Добавлено в избранное');
          // Обновляем кнопки на карточке
          const events = ctx.session.events ?? [];
          const idx = ctx.session.currentIndex ?? 0;
          const total = ctx.session.totalEvents ?? events.length;
          const e = events[idx];
          if (e) {
            await ctx.editMessageReplyMarkup(
              (
                await this.buildCardKeyboard(
                  e,
                  idx,
                  total,
                  ctx.session.searchToken ?? '',
                  ctx
                )
              ).reply_markup
            );
          }
        } else {
          await ctx.answerCbQuery('Ошибка при добавлении');
        }
      } else {
        const success = await this.userService.removeFavorite(
          telegramId,
          eventId
        );
        if (success) {
          await ctx.answerCbQuery('❌ Удалено из избранного');
          // Обновляем кнопки на карточке
          const events = ctx.session.events ?? [];
          const idx = ctx.session.currentIndex ?? 0;
          const total = ctx.session.totalEvents ?? events.length;
          const e = events[idx];
          if (e) {
            await ctx.editMessageReplyMarkup(
              (
                await this.buildCardKeyboard(
                  e,
                  idx,
                  total,
                  ctx.session.searchToken ?? '',
                  ctx
                )
              ).reply_markup
            );
          }
        } else {
          await ctx.answerCbQuery('Ошибка при удалении');
        }
      }
      return;
    }

    // Navigation: prev/next with lazy loading
    if (action === 'nav' && (args[0] === 'p' || args[0] === 'n')) {
      const events = ctx.session.events ?? [];
      const total = ctx.session.totalEvents ?? events.length;
      const current = ctx.session.currentIndex ?? 0;
      const nextIndex = args[0] === 'p' ? current - 1 : current + 1;

      if (nextIndex < 0 || nextIndex >= total) {
        await ctx.answerCbQuery('Это первая/последняя карточка');
        return;
      }

      // Check if we need to load more events
      if (nextIndex >= events.length || !events[nextIndex]) {
        const searchParams = ctx.session.searchParams ?? {};
        const offset = Math.floor(nextIndex / 10) * 10;
        const { items: newEvents } = await this.eventsApi.search({
          ...searchParams,
          limit: 10,
          offset,
        });
        // Merge new events into the existing array
        if (!ctx.session.events) ctx.session.events = [];
        for (let i = 0; i < newEvents.length; i++) {
          ctx.session.events[offset + i] = newEvents[i];
        }
      }

      ctx.session.currentIndex = nextIndex;
      ctx.session.view = 'card';
      const e = (ctx.session.events ?? [])[nextIndex];
      if (!e) {
        await ctx.answerCbQuery('Не удалось загрузить событие');
        return;
      }
      await ctx.editMessageText(formatEventCard(e), {
        parse_mode: 'HTML',
        ...(await this.buildCardKeyboard(
          e,
          nextIndex,
          total,
          ctx.session.searchToken ?? '',
          ctx
        )),
      });
      await ctx.answerCbQuery();
      return;
    }

    // Switch view: list or card
    if (action === 'view' && args[0] === 'list') {
      ctx.session.view = 'list';
      await this.renderList(ctx, 0);
      await ctx.answerCbQuery();
      return;
    }
    if (action === 'view' && args[0] === 'card') {
      const events = ctx.session.events ?? [];
      const total = ctx.session.totalEvents ?? events.length;
      const idx = ctx.session.currentIndex ?? 0;
      const e = events[idx];
      if (e) {
        ctx.session.view = 'card';
        await ctx.editMessageText(formatEventCard(e), {
          parse_mode: 'HTML',
          ...(await this.buildCardKeyboard(
            e,
            idx,
            total,
            ctx.session.searchToken ?? '',
            ctx
          )),
        });
      }
      await ctx.answerCbQuery();
      return;
    }

    // List navigation go to item index
    if (action === 'go') {
      const idx = Number(args[0]);
      const events = ctx.session.events ?? [];
      const total = ctx.session.totalEvents ?? events.length;
      if (Number.isNaN(idx) || idx < 0 || idx >= total) {
        await ctx.answerCbQuery('Элемент недоступен');
        return;
      }

      // Load event if not yet loaded
      if (!events[idx]) {
        const offset = Math.floor(idx / 10) * 10;
        const searchParams = ctx.session.searchParams ?? {};
        const { items: newEvents } = await this.eventsApi.search({
          ...searchParams,
          limit: 10,
          offset,
        });
        // Merge loaded events
        if (!ctx.session.events) ctx.session.events = [];
        for (let i = 0; i < newEvents.length; i++) {
          ctx.session.events[offset + i] = newEvents[i];
        }
      }

      ctx.session.currentIndex = idx;
      ctx.session.view = 'card';
      const e = (ctx.session.events ?? [])[idx];
      if (!e) {
        await ctx.answerCbQuery('Не удалось загрузить событие');
        return;
      }
      await ctx.editMessageText(formatEventCard(e), {
        parse_mode: 'HTML',
        ...(await this.buildCardKeyboard(
          e,
          idx,
          total,
          ctx.session.searchToken ?? '',
          ctx
        )),
      });
      await ctx.answerCbQuery();
      return;
    }

    // List page navigation
    if (action === 'list') {
      const next = Number(args[1] ?? args[0]);
      if (!Number.isFinite(next)) {
        await ctx.answerCbQuery('Страница недоступна');
        return;
      }
      await this.renderList(ctx, next);
      await ctx.answerCbQuery();
      return;
    }

    // Search by date actions with token validation
    if (data.startsWith('s:')) {
      const parts = data.split(':');
      if (parts.length >= 3 && parts[2] === 'd') {
        const token = parts[1];
        if (token !== (ctx.session.searchToken ?? '')) {
          await ctx.answerCbQuery('Сессия поиска устарела');
          return;
        }
        const dateKey = parts[3] as 'today' | 'tomorrow' | 'week' | 'manual';
        if (dateKey === 'manual') {
          await ctx.editMessageText(
            'Введите дату или диапазон в формате:\n- 2025-10-15 (дата)\n- 2025-10-15T14:30 (дата и время)\n- 2025-10-15 — 2025-10-20 (диапазон дат)\n- 2025-10-15T10:00 — 2025-10-15T18:00 (диапазон времени)',
            { parse_mode: undefined }
          );
          // Используем текстовый хэндлер ниже для обработки ввода
          await ctx.answerCbQuery();
          return;
        }
        const now = new Date();
        let dateFrom: string;
        let dateTo: string;
        if (dateKey === 'today') {
          dateFrom = now.toISOString().split('T')[0];
          dateTo = dateFrom;
        } else if (dateKey === 'tomorrow') {
          const t = new Date(now);
          t.setDate(now.getDate() + 1);
          dateFrom = t.toISOString().split('T')[0];
          dateTo = dateFrom;
        } else if (dateKey === 'week') {
          dateFrom = now.toISOString().split('T')[0];
          const week = new Date(now);
          week.setDate(now.getDate() + 7);
          dateTo = week.toISOString().split('T')[0];
        } else {
          await ctx.answerCbQuery('Неизвестный фильтр');
          return;
        }
        const searchParams = { dateFrom, dateTo, limit: 10, offset: 0 };
        const { items: events, total } =
          await this.eventsApi.search(searchParams);
        if (!events.length) {
          await ctx.editMessageText('Ничего не найдено за выбранный период');
          await ctx.answerCbQuery();
          return;
        }
        ctx.session.events = events;
        ctx.session.totalEvents = total;
        ctx.session.searchParams = searchParams;
        ctx.session.currentIndex = 0;
        ctx.session.view = 'card';
        ctx.session.searchToken = this.generateSearchToken();
        const first = events[0];
        await ctx.editMessageText(formatEventCard(first), {
          parse_mode: 'HTML',
          ...(await this.buildCardKeyboard(
            first,
            0,
            total,
            ctx.session.searchToken,
            ctx
          )),
        });
        await ctx.answerCbQuery();
        return;
      }

      if (parts.length >= 3 && parts[2] === 'c') {
        const token = parts[1];
        if (token !== (ctx.session.searchToken ?? '')) {
          await ctx.answerCbQuery('Сессия поиска устарела');
          return;
        }
        const catToken = parts[3];
        const id = this.eventsApi.resolveEventId(catToken);
        if (!id) {
          await ctx.answerCbQuery('Категория недоступна');
          return;
        }
        const searchParams = { categoryId: id, limit: 10, offset: 0 };
        const { items: events, total } =
          await this.eventsApi.search(searchParams);
        if (!events.length) {
          await ctx.editMessageText('В этой категории ничего не найдено');
          await ctx.answerCbQuery();
          return;
        }
        ctx.session.events = events;
        ctx.session.totalEvents = total;
        ctx.session.searchParams = searchParams;
        ctx.session.currentIndex = 0;
        ctx.session.view = 'card';
        ctx.session.searchToken = this.generateSearchToken();
        const first = events[0];
        await ctx.editMessageText(formatEventCard(first), {
          parse_mode: 'HTML',
          ...(await this.buildCardKeyboard(
            first,
            0,
            total,
            ctx.session.searchToken,
            ctx
          )),
        });
        await ctx.answerCbQuery();
        return;
      }
    }
  }

  @On('text')
  async onText(@Ctx() ctx: BotContext) {
    const mode = ctx.session.searchMode ?? null;
    const profileMode = ctx.session.profileEditMode ?? null;
    const text = String((ctx.message as any)?.text ?? '').trim();
    if (!text || text.startsWith('/')) return;

    // Profile edit modes
    if (profileMode === 'phone') {
      const telegramId = String(ctx.from?.id || '');
      const phoneRegex = /^\+?\d{10,15}$/;

      if (!phoneRegex.test(text.replace(/[\s-]/g, ''))) {
        await ctx.reply(
          'Некорректный формат телефона. Используйте формат: +380XXXXXXXXX'
        );
        return;
      }

      const success = await this.userService.updateUserProfile(telegramId, {
        phone: text,
      });
      if (success) {
        ctx.session.profileEditMode = null;
        await ctx.reply('✅ Телефон успешно обновлен!', mainKeyboard());
      } else {
        await ctx.reply('❌ Ошибка при обновлении телефона', mainKeyboard());
      }
      return;
    }

    if (profileMode === 'email') {
      const telegramId = String(ctx.from?.id || '');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(text)) {
        await ctx.reply(
          'Некорректный формат email. Введите правильный email адрес.'
        );
        return;
      }

      const success = await this.userService.updateUserProfile(telegramId, {
        email: text,
      });
      if (success) {
        ctx.session.profileEditMode = null;
        await ctx.reply('✅ Email успешно обновлен!', mainKeyboard());
      } else {
        await ctx.reply('❌ Ошибка при обновлении email', mainKeyboard());
      }
      return;
    }

    if (profileMode === 'price') {
      const telegramId = String(ctx.from?.id || '');

      // Сброс цен
      if (text === '0') {
        const success = await this.userService.updatePricePreferences(
          telegramId,
          null,
          null
        );
        if (success) {
          ctx.session.profileEditMode = null;
          await ctx.reply('✅ Ценовые предпочтения сброшены!', mainKeyboard());
        } else {
          await ctx.reply('❌ Ошибка при сбросе', mainKeyboard());
        }
        return;
      }

      const priceMatch = text.match(/^(-?\d+)(?:-(-?\d+))?$/);
      if (!priceMatch) {
        await ctx.reply(
          'Неверный формат цены. Используйте:\n- 100-500\n- 200\n- -300\n- 0 (сброс)'
        );
        return;
      }

      const [, fromStr, toStr] = priceMatch;
      let priceMin: number | undefined;
      let priceMax: number | undefined;

      if (fromStr.startsWith('-')) {
        // Only upper bound: -300 means up to 300
        priceMax = Math.abs(Number(fromStr));
      } else if (toStr) {
        // Range: 100-500
        priceMin = Number(fromStr);
        priceMax = Number(toStr);
      } else {
        // Only lower bound: 200 means from 200
        priceMin = Number(fromStr);
      }

      const success = await this.userService.updatePricePreferences(
        telegramId,
        priceMin,
        priceMax
      );
      if (success) {
        ctx.session.profileEditMode = null;
        const rangeStr: string[] = [];
        if (priceMin) rangeStr.push(`от ${priceMin} грн`);
        if (priceMax) rangeStr.push(`до ${priceMax} грн`);
        await ctx.reply(
          `✅ Ценовые предпочтения обновлены: ${rangeStr.join(' ')}`,
          mainKeyboard()
        );
      } else {
        await ctx.reply('❌ Ошибка при обновлении', mainKeyboard());
      }
      return;
    }
    // Manual date input (supports both date and datetime)
    const manualDateMatch = text.match(
      /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)(?:\s*[–—-]\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?))?$/
    );
    if (manualDateMatch) {
      const [, from, to] = manualDateMatch;
      console.log('[BotUpdate] Manual date input - from:', from, 'to:', to);

      // Convert local time to UTC for API
      const convertToUTC = (localTime: string) => {
        const date = new Date(localTime);
        return date.toISOString();
      };

      const searchParams: any = {
        dateFrom: convertToUTC(from),
        limit: 10,
        offset: 0,
      };
      if (to) searchParams.dateTo = convertToUTC(to);
      else searchParams.dateTo = convertToUTC(from);

      console.log('[BotUpdate] Search params (UTC):', searchParams);
      const { items: events, total } =
        await this.eventsApi.search(searchParams);
      if (!events.length) {
        await ctx.reply('Ничего не найдено для указанной даты/диапазона.');
        return;
      }
      ctx.session.events = events;
      ctx.session.totalEvents = total;
      ctx.session.searchParams = searchParams;
      ctx.session.currentIndex = 0;
      ctx.session.view = 'card';
      ctx.session.searchToken = this.generateSearchToken();
      const first = events[0];
      await ctx.replyWithHTML(
        formatEventCard(first),
        await this.buildCardKeyboard(
          first,
          0,
          total,
          ctx.session.searchToken,
          ctx
        )
      );
      return;
    }

    // Price range input
    if (mode === 'price') {
      const priceMatch = text.match(/^(-?\d+)(?:-(-?\d+))?$/);
      if (!priceMatch) {
        await ctx.reply(
          'Неверный формат цены. Используйте: 100-500, 200, или -300'
        );
        return;
      }
      const [, fromStr, toStr] = priceMatch;
      const searchParams: any = { limit: 10, offset: 0 };
      if (fromStr.startsWith('-')) {
        // Only upper bound: -300 means up to 300
        searchParams.priceTo = Math.abs(Number(fromStr));
      } else if (toStr) {
        // Range: 100-500
        searchParams.priceFrom = Number(fromStr);
        searchParams.priceTo = Number(toStr);
      } else {
        // Only lower bound: 200 means from 200
        searchParams.priceFrom = Number(fromStr);
      }
      const { items: events, total } =
        await this.eventsApi.search(searchParams);
      if (!events.length) {
        await ctx.reply('Ничего не найдено в указанном ценовом диапазоне.');
        return;
      }
      ctx.session.events = events;
      ctx.session.totalEvents = total;
      ctx.session.searchParams = searchParams;
      ctx.session.currentIndex = 0;
      ctx.session.view = 'card';
      ctx.session.searchToken = this.generateSearchToken();
      const first = events[0];
      await ctx.replyWithHTML(
        formatEventCard(first),
        await this.buildCardKeyboard(
          first,
          0,
          total,
          ctx.session.searchToken,
          ctx
        )
      );
      return;
    }

    if (mode !== 'name' && mode !== 'venue') return;
    const searchParams =
      mode === 'name'
        ? { q: text, limit: 10, offset: 0 }
        : { venueName: text, limit: 10, offset: 0 };
    const { items: events, total } = await this.eventsApi.search(searchParams);
    if (!events.length) {
      await ctx.reply('Ничего не найдено. Попробуйте уточнить запрос.');
      return;
    }

    ctx.session.events = events;
    ctx.session.totalEvents = total;
    ctx.session.searchParams = searchParams;
    ctx.session.currentIndex = 0;
    ctx.session.view = 'card';
    ctx.session.searchToken = this.generateSearchToken();
    const first = events[0];
    await ctx.replyWithHTML(
      formatEventCard(first),
      await this.buildCardKeyboard(
        first,
        0,
        total,
        ctx.session.searchToken,
        ctx
      )
    );
  }

  private async buildCardKeyboard(
    e: import('./events-api.service.js').EventItem,
    index: number,
    total: number,
    token?: string,
    ctx?: BotContext
  ) {
    const t = token ? `t:${token}:` : '';
    const navRow = [
      Markup.button.callback('◀️', `${t}nav:p`),
      Markup.button.callback(`${index + 1}/${total}`, `${t}noop`),
      Markup.button.callback('▶️', `${t}nav:n`),
    ];

    // Проверяем, в избранном ли событие
    let isFav = false;
    if (ctx?.from?.id) {
      const telegramId = String(ctx.from.id);
      isFav = await this.userService.isFavorite(telegramId, e.id);
    }

    // Используем короткий токен вместо полного ID (callback_data ограничен 64 байтами)
    const eventToken = this.eventsApi.tokenForEventId(e.id);
    const favButton = isFav
      ? Markup.button.callback(
          '💔 Удалить из избранного',
          `${t}fav:remove:${eventToken}`
        )
      : Markup.button.callback(
          '⭐️ Добавить в избранное',
          `${t}fav:add:${eventToken}`
        );

    const listRow = [Markup.button.callback('📋 Список', `${t}view:list`)];
    const abs = resolveEventUrl(e.source_url);
    const openRow = abs ? [Markup.button.url('🔗 Открыть', abs)] : [];
    return Markup.inlineKeyboard([
      navRow,
      [favButton],
      listRow,
      ...(openRow.length ? [openRow] : []),
    ]);
  }

  private async renderList(ctx: BotContext, page: number) {
    const total = ctx.session.totalEvents ?? ctx.session.events?.length ?? 0;
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const bounded = Math.max(0, Math.min(totalPages - 1, page));
    const start = bounded * pageSize;
    const end = Math.min(start + pageSize, total);

    // Load events for this page if not yet loaded
    if (!ctx.session.events) ctx.session.events = [];
    for (let i = start; i < end; i++) {
      if (!ctx.session.events[i]) {
        // Need to load this event
        const offset = Math.floor(i / 10) * 10;
        const searchParams = ctx.session.searchParams ?? {};
        const { items: newEvents } = await this.eventsApi.search({
          ...searchParams,
          limit: 10,
          offset,
        });
        // Merge loaded events
        for (let j = 0; j < newEvents.length; j++) {
          ctx.session.events[offset + j] = newEvents[j];
        }
      }
    }

    // Get events for current page
    const slice: any[] = [];
    for (let i = start; i < end; i++) {
      const e = ctx.session.events[i];
      if (e) slice.push(e);
    }

    const lines = slice.map((e, i) => {
      const num = start + i + 1;
      const date = e.date_time_from ?? e.date_time ?? e.date_time_to;
      const dateStr = date
        ? new Date(date).toLocaleString('ru-RU', {
            dateStyle: 'short',
            timeStyle: 'short',
          })
        : '';
      return `${num}. ${e.title ?? 'Без названия'}${dateStr ? ` — ${dateStr}` : ''}`;
    });
    const header = `Найдено: ${total}\nСтраница ${bounded + 1}/${totalPages}`;
    const text = [header, '', ...lines].join('\n');

    // Build number buttons for this page
    const t = ctx.session.searchToken ? `t:${ctx.session.searchToken}:` : '';
    const numberButtons = slice.map((_, i) =>
      Markup.button.callback(String(start + i + 1), `${t}go:${start + i}`)
    );
    const numbersRows: any[] = [];
    // chunk by 5 per row
    for (let i = 0; i < numberButtons.length; i += 5) {
      numbersRows.push(numberButtons.slice(i, i + 5));
    }
    const navRow = [
      Markup.button.callback('◀️', `${t}list:${bounded - 1}`),
      Markup.button.callback(`${bounded + 1}/${totalPages}`, `${t}noop`),
      Markup.button.callback('▶️', `${t}list:${bounded + 1}`),
    ];
    const toCardRow = [
      Markup.button.callback('🔙 К карточке', `${t}view:card`),
    ];

    await ctx.editMessageText(text, {
      parse_mode: undefined,
      reply_markup: {
        inline_keyboard: [...numbersRows, navRow, toCardRow],
      },
    });
  }
}
