export interface InstagramPost {
  id: string;
  type: string;
  shortCode: string;
  caption?: string;
  hashtags?: string[];
  mentions?: string[];
  url: string;
  commentsCount?: number;
  likesCount?: number;
  timestamp?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  ownerId?: string;
  locationName?: string;
  locationId?: string;
  images?: string[];
  displayUrl?: string;
  videoUrl?: string;
  childPosts?: InstagramPost[];
  taggedUsers?: {
    username: string;
    full_name?: string;
    id?: string;
  }[];
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  category_name?: string;
  venue_name?: string;
  category_id?: null;
  venue_id?: null;
  date_time?: string;
  date_time_from?: string;
  date_time_to?: string;
  price_from?: number;
  source_url: string;
}

export interface ScraperConfig {
  accounts: string[];
  hashtags?: string[];
  locations?: string[];
  resultsLimit: number;
  apifyToken: string;
  apifyActorId?: string;
  saveOutput?: boolean;
  outputFile?: string;
  scheduleInterval?: string; // cron expression
}

export interface ExtractedEventInfo {
  title?: string;
  venue?: string;
  date?: string;
  time?: string;
  price?: string;
  description?: string;
  category?: string;
}