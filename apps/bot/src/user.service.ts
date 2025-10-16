import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@concierge/database';
import { User as PrismaUser, UserPreference as PrismaUserPreference } from '@prisma/client';

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

  constructor(private readonly prisma: PrismaService) {}

  private mapPrismaUserToUser(user: PrismaUser): User {
    return {
      id: user.id,
      telegram_id: user.telegramId.toString(),
      name: user.name ?? undefined,
      phone: user.phone ?? undefined,
      email: user.email ?? undefined,
      subscription_type: user.subscriptionType,
      created_at: user.createdAt,
    };
  }

  private mapPrismaPreferencesToUserPreferences(
    pref: PrismaUserPreference
  ): UserPreferences {
    return {
      id: pref.id,
      user_id: pref.userId,
      category_ids: pref.categoryIds,
      district_ids: pref.districtIds,
      price_min: pref.priceMin ? Number(pref.priceMin) : undefined,
      price_max: pref.priceMax ? Number(pref.priceMax) : undefined,
      created_at: pref.createdAt,
      updated_at: pref.updatedAt,
    };
  }

  /**
   * Регистрация или получение существующего пользователя
   */
  async registerOrGetUser(telegramId: string, name?: string): Promise<User> {
    try {
      const telegramIdBigInt = BigInt(telegramId);

      const user = await this.prisma.user.upsert({
        where: { telegramId: telegramIdBigInt },
        create: {
          telegramId: telegramIdBigInt,
          name: name || null,
          subscriptionType: 'free',
        },
        update: name ? { name } : {},
      });

      if (!name) {
        this.logger.log(`Registered new user: ${telegramId} (${name || 'unnamed'})`);
      }

      return this.mapPrismaUserToUser(user);
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
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      return user ? this.mapPrismaUserToUser(user) : null;
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

      await this.prisma.favorite.upsert({
        where: {
          userId_eventId: {
            userId: user.id,
            eventId,
          },
        },
        create: {
          userId: user.id,
          eventId,
        },
        update: {},
      });

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

      await this.prisma.favorite.delete({
        where: {
          userId_eventId: {
            userId: user.id,
            eventId,
          },
        },
      });

      this.logger.log(`Removed favorite: user=${user.id}, event=${eventId}`);
      return true;
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

      const favorite = await this.prisma.favorite.findUnique({
        where: {
          userId_eventId: {
            userId: user.id,
            eventId,
          },
        },
      });

      return favorite !== null;
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

      const favorites = await this.prisma.favorite.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { eventId: true },
      });

      return favorites.map((f) => f.eventId);
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

      return this.prisma.favorite.count({
        where: { userId: user.id },
      });
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

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          name: data.name !== undefined ? data.name : undefined,
          phone: data.phone !== undefined ? data.phone : undefined,
          email: data.email !== undefined ? data.email : undefined,
        },
      });

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

      const preferences = await this.prisma.userPreference.findUnique({
        where: { userId: user.id },
      });

      return preferences
        ? this.mapPrismaPreferencesToUserPreferences(preferences)
        : null;
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

      const updateData: any = {};

      if (preferences.category_ids !== undefined) {
        updateData.categoryIds = preferences.category_ids;
      }
      if (preferences.district_ids !== undefined) {
        updateData.districtIds = preferences.district_ids;
      }
      if (preferences.price_min !== undefined) {
        updateData.priceMin = preferences.price_min;
      }
      if (preferences.price_max !== undefined) {
        updateData.priceMax = preferences.price_max;
      }

      await this.prisma.userPreference.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          categoryIds: preferences.category_ids || [],
          districtIds: preferences.district_ids || [],
          priceMin: preferences.price_min,
          priceMax: preferences.price_max,
        },
        update: updateData,
      });

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

      await this.prisma.userPreference.delete({
        where: { userId: user.id },
      });

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
      const usersWithPrefs = await this.prisma.user.findMany({
        where: {
          preferences: {
            OR: [
              { categoryIds: { isEmpty: false } },
              { districtIds: { isEmpty: false } },
              { priceMin: { not: null } },
              { priceMax: { not: null } },
            ],
          },
        },
        include: {
          preferences: true,
        },
      });

      return usersWithPrefs
        .filter((u) => u.preferences !== null)
        .map((u) => ({
          user: this.mapPrismaUserToUser(u),
          preferences: this.mapPrismaPreferencesToUserPreferences(
            u.preferences!
          ),
        }));
    } catch (error) {
      this.logger.error('Failed to get users with preferences:', error);
      return [];
    }
  }
}
