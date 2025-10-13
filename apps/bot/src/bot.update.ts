import { Ctx, Hears, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import type { Context, Scenes } from 'telegraf';
import { Markup } from 'telegraf';
import { EventsApiService } from './events-api.service.js';
import { formatEventCard, mainKeyboard, resolveEventUrl } from './keyboards.js';

export interface SessionData {
  selectedCategories?: string[];
  events?: import('./events-api.service.js').EventItem[];
  currentIndex?: number;
  view?: 'card' | 'list';
  searchMode?: 'name' | 'price' | 'venue' | null;
  searchParams?: any; // Last search params for lazy loading
  totalEvents?: number; // Total count from server
}

export type BotContext = Context &
  Scenes.WizardContext & { session: SessionData };

@Update()
export class BotUpdate {
  constructor(
    private readonly eventsApi: EventsApiService,
    @InjectBot() private readonly bot: any
  ) {}

  @Start()
  async onStart(@Ctx() ctx: BotContext) {
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
    await ctx.reply(
      'Выберите период:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Сегодня', 's:d:today')],
        [Markup.button.callback('Завтра', 's:d:tomorrow')],
        [Markup.button.callback('7 дней', 's:d:week')],
        [Markup.button.callback('Ввести вручную', 's:d:manual')],
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
          .map((c, j) => Markup.button.callback(c.name, `s:c:${tokens[i + j]}`))
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
    const first = events[0];
    await ctx.replyWithHTML(
      formatEventCard(first),
      this.buildCardKeyboard(first, 0, total)
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

    if (data === 'noop') {
      await ctx.answerCbQuery();
      return;
    }

    // Navigation: prev/next with lazy loading
    if (data === 'nav:p' || data === 'nav:n') {
      const events = ctx.session.events ?? [];
      const total = ctx.session.totalEvents ?? events.length;
      const current = ctx.session.currentIndex ?? 0;
      const nextIndex = data === 'nav:p' ? current - 1 : current + 1;

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
        ...this.buildCardKeyboard(e, nextIndex, total),
      });
      await ctx.answerCbQuery();
      return;
    }

    // Switch view: list or card
    if (data === 'view:list') {
      ctx.session.view = 'list';
      await this.renderList(ctx, 0);
      await ctx.answerCbQuery();
      return;
    }
    if (data === 'view:card') {
      const events = ctx.session.events ?? [];
      const total = ctx.session.totalEvents ?? events.length;
      const idx = ctx.session.currentIndex ?? 0;
      const e = events[idx];
      if (e) {
        ctx.session.view = 'card';
        await ctx.editMessageText(formatEventCard(e), {
          parse_mode: 'HTML',
          ...this.buildCardKeyboard(e, idx, total),
        });
      }
      await ctx.answerCbQuery();
      return;
    }

    // List navigation go to item index
    if (data.startsWith('go:')) {
      const idx = Number(data.slice(3));
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
        ...this.buildCardKeyboard(e, idx, total),
      });
      await ctx.answerCbQuery();
      return;
    }

    // List page navigation
    if (data.startsWith('list:')) {
      const parts = data.split(':');
      const next = Number(parts[2]);
      if (!Number.isFinite(next)) {
        await ctx.answerCbQuery('Страница недоступна');
        return;
      }
      await this.renderList(ctx, next);
      await ctx.answerCbQuery();
      return;
    }

    // Search by date actions
    if (data.startsWith('s:d:')) {
      const dateKey = data.slice(4) as 'today' | 'tomorrow' | 'week' | 'manual';
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
      const first = events[0];
      await ctx.editMessageText(formatEventCard(first), {
        parse_mode: 'HTML',
        ...this.buildCardKeyboard(first, 0, total),
      });
      await ctx.answerCbQuery();
      return;
    }

    if (data.startsWith('s:c:')) {
      const token = data.slice(4);
      const id = this.eventsApi.resolveEventId(token);
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
      const first = events[0];
      await ctx.editMessageText(formatEventCard(first), {
        parse_mode: 'HTML',
        ...this.buildCardKeyboard(first, 0, total),
      });
      await ctx.answerCbQuery();
      return;
    }
  }

  @On('text')
  async onText(@Ctx() ctx: BotContext) {
    const mode = ctx.session.searchMode ?? null;
    const text = String((ctx.message as any)?.text ?? '').trim();
    if (!text || text.startsWith('/')) return;
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
      const first = events[0];
      await ctx.replyWithHTML(
        formatEventCard(first),
        this.buildCardKeyboard(first, 0, total)
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
      const first = events[0];
      await ctx.replyWithHTML(
        formatEventCard(first),
        this.buildCardKeyboard(first, 0, total)
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
    const first = events[0];
    await ctx.replyWithHTML(
      formatEventCard(first),
      this.buildCardKeyboard(first, 0, total)
    );
  }

  private buildCardKeyboard(
    e: import('./events-api.service.js').EventItem,
    index: number,
    total: number
  ) {
    const navRow = [
      Markup.button.callback('◀️', 'nav:p'),
      Markup.button.callback(`${index + 1}/${total}`, 'noop'),
      Markup.button.callback('▶️', 'nav:n'),
    ];
    const listRow = [Markup.button.callback('📋 Список', 'view:list')];
    const abs = resolveEventUrl(e.source_url);
    const openRow = abs ? [Markup.button.url('🔗 Открыть', abs)] : [];
    return Markup.inlineKeyboard([
      navRow,
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
    const numberButtons = slice.map((_, i) =>
      Markup.button.callback(String(start + i + 1), `go:${start + i}`)
    );
    const numbersRows: any[] = [];
    // chunk by 5 per row
    for (let i = 0; i < numberButtons.length; i += 5) {
      numbersRows.push(numberButtons.slice(i, i + 5));
    }
    const navRow = [
      Markup.button.callback('◀️', `list:p:${bounded - 1}`),
      Markup.button.callback(`${bounded + 1}/${totalPages}`, 'noop'),
      Markup.button.callback('▶️', `list:n:${bounded + 1}`),
    ];
    const toCardRow = [Markup.button.callback('🔙 К карточке', 'view:card')];

    await ctx.editMessageText(text, {
      parse_mode: undefined,
      reply_markup: {
        inline_keyboard: [...numbersRows, navRow, toCardRow],
      },
    });
  }
}
