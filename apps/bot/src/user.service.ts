import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface User {
  id: number;
  telegram_id: string;
  name?: string;
  phone?: string;
  email?: string;
  subscription_type: string;
  created_at: Date;
}

export interface Favorite {
  id: number;
  user_id: number;
  event_id: string;
  created_at: Date;
}

export interface UserPreferences {
  id: number;
  user_id: number;
  category_ids?: string[];
  district_ids?: string[];
  price_min?: number;
  price_max?: number;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Регистрация или получение существующего пользователя
   */
  async registerOrGetUser(telegramId: string, name?: string): Promise<User> {
    try {
      // Проверяем, существует ли пользователь
      const existing = await this.db.query<User>(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
      );

      if (existing.rows.length > 0) {
        // Обновляем имя, если оно изменилось
        if (name && existing.rows[0].name !== name) {
          await this.db.query(
            'UPDATE users SET name = $1 WHERE telegram_id = $2',
            [name, telegramId]
          );
          return { ...existing.rows[0], name };
        }
        return existing.rows[0];
      }

      // Создаем нового пользователя
      const result = await this.db.query<User>(
        `INSERT INTO users (telegram_id, name, subscription_type) 
         VALUES ($1, $2, 'free') 
         RETURNING *`,
        [telegramId, name || null]
      );

      this.logger.log(
        `Registered new user: ${telegramId} (${name || 'unnamed'})`
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error('Failed to register or get user:', error);
      throw error;
    }
  }

  /**
   * Получить пользователя по Telegram ID
   */
  async getUserByTelegramId(telegramId: string): Promise<User | null> {
    try {
      const result = await this.db.query<User>(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
      );
      return result.rows[0] || null;
    } catch (error) {
      this.logger.error('Failed to get user by telegram_id:', error);
      return null;
    }
  }

  /**
   * Добавить событие в избранное
   */
  async addFavorite(telegramId: string, eventId: string): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        this.logger.warn(`User not found: ${telegramId}`);
        return false;
      }

      await this.db.query(
        `INSERT INTO favorites (user_id, event_id) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id, event_id) DO NOTHING`,
        [user.id, eventId]
      );

      this.logger.log(`Added favorite: user=${user.id}, event=${eventId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to add favorite:', error);
      return false;
    }
  }

  /**
   * Удалить событие из избранного
   */
  async removeFavorite(telegramId: string, eventId: string): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        this.logger.warn(`User not found: ${telegramId}`);
        return false;
      }

      const result = await this.db.query(
        'DELETE FROM favorites WHERE user_id = $1 AND event_id = $2',
        [user.id, eventId]
      );

      this.logger.log(`Removed favorite: user=${user.id}, event=${eventId}`);
      return (result as any).rowCount > 0;
    } catch (error) {
      this.logger.error('Failed to remove favorite:', error);
      return false;
    }
  }

  /**
   * Проверить, находится ли событие в избранном
   */
  async isFavorite(telegramId: string, eventId: string): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) return false;

      const result = await this.db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM favorites WHERE user_id = $1 AND event_id = $2',
        [user.id, eventId]
      );

      return parseInt(result.rows[0]?.count || '0') > 0;
    } catch (error) {
      this.logger.error('Failed to check favorite:', error);
      return false;
    }
  }

  /**
   * Получить список избранных событий пользователя
   */
  async getFavorites(telegramId: string): Promise<string[]> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) return [];

      const result = await this.db.query<{ event_id: string }>(
        'SELECT event_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC',
        [user.id]
      );

      return result.rows.map(r => r.event_id);
    } catch (error) {
      this.logger.error('Failed to get favorites:', error);
      return [];
    }
  }

  /**
   * Получить количество избранных событий
   */
  async getFavoritesCount(telegramId: string): Promise<number> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) return 0;

      const result = await this.db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM favorites WHERE user_id = $1',
        [user.id]
      );

      return parseInt(result.rows[0]?.count || '0');
    } catch (error) {
      this.logger.error('Failed to get favorites count:', error);
      return 0;
    }
  }

  /**
   * Обновить контактные данные пользователя
   */
  async updateUserProfile(
    telegramId: string,
    data: { phone?: string; email?: string; name?: string }
  ): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        this.logger.warn(`User not found: ${telegramId}`);
        return false;
      }

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.phone !== undefined) {
        updates.push(`phone = $${paramIndex++}`);
        values.push(data.phone);
      }
      if (data.email !== undefined) {
        updates.push(`email = $${paramIndex++}`);
        values.push(data.email);
      }

      if (updates.length === 0) return true;

      values.push(user.id);
      await this.db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      this.logger.log(`Updated profile for user: ${telegramId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to update user profile:', error);
      return false;
    }
  }

  /**
   * Получить предпочтения пользователя
   */
  async getUserPreferences(
    telegramId: string
  ): Promise<UserPreferences | null> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) return null;

      const result = await this.db.query<UserPreferences>(
        'SELECT * FROM user_preferences WHERE user_id = $1',
        [user.id]
      );

      return result.rows[0] || null;
    } catch (error) {
      this.logger.error('Failed to get user preferences:', error);
      return null;
    }
  }

  /**
   * Создать или обновить предпочтения пользователя
   */
  async upsertUserPreferences(
    telegramId: string,
    preferences: {
      category_ids?: string[];
      district_ids?: string[];
      price_min?: number | null;
      price_max?: number | null;
    }
  ): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) {
        this.logger.warn(`User not found: ${telegramId}`);
        return false;
      }

      const { category_ids, district_ids, price_min, price_max } = preferences;

      // Флаги для определения, нужно ли обновлять цены
      const updatePriceMin = price_min !== undefined;
      const updatePriceMax = price_max !== undefined;

      await this.db.query(
        `INSERT INTO user_preferences (user_id, category_ids, district_ids, price_min, price_max)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           category_ids = COALESCE($2, user_preferences.category_ids),
           district_ids = COALESCE($3, user_preferences.district_ids),
           price_min = CASE WHEN $6 = true THEN $4 ELSE user_preferences.price_min END,
           price_max = CASE WHEN $7 = true THEN $5 ELSE user_preferences.price_max END,
           updated_at = NOW()`,
        [
          user.id,
          category_ids || null,
          district_ids || null,
          price_min !== undefined ? price_min : null,
          price_max !== undefined ? price_max : null,
          updatePriceMin,
          updatePriceMax,
        ]
      );

      this.logger.log(`Updated preferences for user: ${telegramId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to upsert user preferences:', error);
      return false;
    }
  }

  /**
   * Обновить предпочтения по категориям
   */
  async updateCategoryPreferences(
    telegramId: string,
    categoryIds: string[]
  ): Promise<boolean> {
    return this.upsertUserPreferences(telegramId, {
      category_ids: categoryIds,
    });
  }

  /**
   * Обновить предпочтения по районам
   */
  async updateDistrictPreferences(
    telegramId: string,
    districtIds: string[]
  ): Promise<boolean> {
    return this.upsertUserPreferences(telegramId, {
      district_ids: districtIds,
    });
  }

  /**
   * Обновить ценовые предпочтения
   */
  async updatePricePreferences(
    telegramId: string,
    priceMin?: number | null,
    priceMax?: number | null
  ): Promise<boolean> {
    return this.upsertUserPreferences(telegramId, {
      price_min: priceMin,
      price_max: priceMax,
    });
  }

  /**
   * Очистить все предпочтения пользователя
   */
  async clearUserPreferences(telegramId: string): Promise<boolean> {
    try {
      const user = await this.getUserByTelegramId(telegramId);
      if (!user) return false;

      await this.db.query('DELETE FROM user_preferences WHERE user_id = $1', [
        user.id,
      ]);

      this.logger.log(`Cleared preferences for user: ${telegramId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to clear user preferences:', error);
      return false;
    }
  }

  /**
   * Получить всех пользователей с настроенными предпочтениями
   */
  async getAllUsersWithPreferences(): Promise<
    Array<{ user: User; preferences: UserPreferences }>
  > {
    try {
      const result = await this.db.query<{
        user_id: number;
        telegram_id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        subscription_type: string;
        user_created_at: Date;
        pref_id: number;
        category_ids: string[] | null;
        district_ids: string[] | null;
        price_min: number | null;
        price_max: number | null;
        pref_created_at: Date;
        pref_updated_at: Date;
      }>(
        `SELECT 
          u.id as user_id, 
          u.telegram_id, 
          u.name, 
          u.phone, 
          u.email, 
          u.subscription_type,
          u.created_at as user_created_at,
          up.id as pref_id,
          up.category_ids,
          up.district_ids,
          up.price_min,
          up.price_max,
          up.created_at as pref_created_at,
          up.updated_at as pref_updated_at
        FROM users u
        INNER JOIN user_preferences up ON u.id = up.user_id
        WHERE up.category_ids IS NOT NULL 
           OR up.district_ids IS NOT NULL 
           OR up.price_min IS NOT NULL 
           OR up.price_max IS NOT NULL`
      );

      return result.rows.map(row => ({
        user: {
          id: row.user_id,
          telegram_id: row.telegram_id,
          name: row.name ?? undefined,
          phone: row.phone ?? undefined,
          email: row.email ?? undefined,
          subscription_type: row.subscription_type,
          created_at: row.user_created_at,
        },
        preferences: {
          id: row.pref_id,
          user_id: row.user_id,
          category_ids: row.category_ids ?? undefined,
          district_ids: row.district_ids ?? undefined,
          price_min: row.price_min ?? undefined,
          price_max: row.price_max ?? undefined,
          created_at: row.pref_created_at,
          updated_at: row.pref_updated_at,
        },
      }));
    } catch (error) {
      this.logger.error('Failed to get users with preferences:', error);
      return [];
    }
  }
}
