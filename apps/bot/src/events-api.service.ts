import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface EventItem {
  id: string;
  title?: string | null;
  description?: string | null;
  category_id?: string | null;
  venue_id?: string | null;
  date_time?: string | null;
  date_time_from?: string | null;
  date_time_to?: string | null;
  price_from?: number | null;
  source_url?: string | null;
}

export interface SearchParams {
  q?: string;
  categoryId?: string | string[]; // Поддержка одной или нескольких категорий
  venueName?: string;
  date?: 'today' | 'tomorrow' | 'week' | string; // ISO date
  dateFrom?: string; // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  dateTo?: string; // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  priceFrom?: number;
  priceTo?: number;
  limit?: number;
  offset?: number;
}

export interface CategoryItem {
  id: string;
  name: string;
  icon?: string | null;
  parent_id?: string | null;
}

@Injectable()
export class EventsApiService {
  private readonly http: AxiosInstance;
  private readonly tokenToId = new Map<string, string>();

  constructor() {
    const baseURL = process.env.API_BASE_URL ?? 'http://localhost:3000';
    this.http = axios.create({ baseURL });
  }

  async all(): Promise<EventItem[]> {
    const { data } = await this.http.get('/events');
    return data ?? [];
  }

  async categories(): Promise<CategoryItem[]> {
    const { data } = await this.http.get('/events/categories/all');
    return data ?? [];
  }

  async getById(id: string): Promise<EventItem | null> {
    try {
      const { data } = await this.http.get(`/events/${id}`);
      return data ?? null;
    } catch {
      return null;
    }
  }

  async search(
    params: SearchParams
  ): Promise<{ items: EventItem[]; total: number }> {
    const limit = params.limit ?? 10;
    const offset = params.offset ?? 0;
    const canServerSearch =
      Boolean(params.q) ||
      Boolean(params.categoryId) ||
      Boolean(params.venueName) ||
      Boolean(params.dateFrom) ||
      Boolean(params.dateTo) ||
      params.priceFrom !== undefined ||
      params.priceTo !== undefined;

    console.log('[EventsApiService] search params:', JSON.stringify(params));
    console.log('[EventsApiService] canServerSearch:', canServerSearch);

    if (canServerSearch) {
      try {
        const requestParams = {
          q: params.q,
          categoryId: params.categoryId,
          venueName: params.venueName,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          priceFrom: params.priceFrom,
          priceTo: params.priceTo,
          limit,
          offset,
        };
        console.log(
          '[EventsApiService] requesting /events/search with:',
          requestParams
        );
        const { data } = await this.http.get('/events/search', {
          params: requestParams,
        });
        console.log('[EventsApiService] response data:', JSON.stringify(data));
        const items = (data?.items as EventItem[]) ?? [];
        const total = (data?.total as number) ?? items.length;
        console.log(
          '[EventsApiService] returning',
          items.length,
          'items, total:',
          total
        );
        return { items, total };
      } catch (err) {
        console.error('[EventsApiService] Server search failed:', err);
        if (err && typeof err === 'object' && 'response' in err) {
          console.error(
            '[EventsApiService] Response error:',
            (err as any).response?.data
          );
        }
        return { items: [], total: 0 };
      }
    }
    const items = await this.all();
    const now = new Date();
    const filtered = items.filter(e => {
      const title = (e.title ?? '').toLowerCase();
      if (params.q && !title.includes(params.q.toLowerCase())) return false;
      if (params.categoryId && e.category_id !== params.categoryId)
        return false;
      if (params.date) {
        const dtStr = e.date_time_from ?? e.date_time ?? e.date_time_to;
        if (!dtStr) return false;
        const dt = new Date(dtStr);
        if (params.date === 'today') {
          const sameDay = dt.toDateString() === now.toDateString();
          if (!sameDay) return false;
        } else if (params.date === 'tomorrow') {
          const t = new Date(now);
          t.setDate(now.getDate() + 1);
          const sameDay = dt.toDateString() === t.toDateString();
          if (!sameDay) return false;
        } else if (params.date === 'week') {
          const week = new Date(now);
          week.setDate(now.getDate() + 7);
          if (!(dt >= startOfDay(now) && dt <= endOfDay(week))) return false;
        }
        // Other date filters can be implemented later
      }
      if (params.dateFrom || params.dateTo) {
        const dtStr = e.date_time_from ?? e.date_time ?? e.date_time_to;
        if (!dtStr) return false;
        const dt = new Date(dtStr);
        const from = params.dateFrom
          ? startOfDay(new Date(params.dateFrom))
          : null;
        const to = params.dateTo
          ? endOfDay(new Date(params.dateTo))
          : from
            ? endOfDay(new Date(params.dateFrom as string))
            : null;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
      }
      if (
        params.priceFrom !== undefined &&
        (e.price_from ?? 0) < params.priceFrom
      )
        return false;
      if (params.priceTo !== undefined && (e.price_from ?? 0) > params.priceTo)
        return false;
      return true;
    });
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  tokenForEventId(id: string): string {
    // Generate short random token to keep callback_data under 64 bytes
    const token = Math.random().toString(36).slice(2, 10); // 8 chars
    this.tokenToId.set(token, id);
    return token;
  }

  resolveEventId(token: string): string | null {
    return this.tokenToId.get(token) ?? null;
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
