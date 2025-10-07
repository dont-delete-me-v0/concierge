import {
  devices,
  type Browser,
  type LaunchOptions,
  type Page,
} from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { computeRowHash } from './incremental.js';
import { PaginationHandler } from './pagination.js';
import type { ExtractedRow, ScraperConfig } from './types.js';
chromium.use(StealthPlugin());

let userAgentSequentialIndex = 0;

export class ConfigurableScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly config: ScraperConfig;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    console.log('Initializing browser...');
    const launchOptions: LaunchOptions = {
      headless: this.config.headless ?? false, // Default to visible for debugging
      proxy: this.config.proxyServer
        ? { server: this.config.proxyServer }
        : undefined,
      timeout: this.config.timeoutMs ?? 30000,
    };
    console.log('Launch options:', launchOptions);
    this.browser = await chromium.launch(launchOptions);
    console.log('Browser launched successfully');
    const configuredUserAgents = this.config.userAgents ?? [];
    let selectedUserAgent: string | undefined;
    if (configuredUserAgents.length > 0) {
      if ((this.config.userAgentRotation ?? 'random') === 'sequential') {
        selectedUserAgent =
          configuredUserAgents[
            userAgentSequentialIndex % configuredUserAgents.length
          ];
        userAgentSequentialIndex =
          (userAgentSequentialIndex + 1) % configuredUserAgents.length;
      } else {
        const idx = Math.floor(Math.random() * configuredUserAgents.length);
        selectedUserAgent = configuredUserAgents[idx];
      }
    }

    const context = await this.browser.newContext({
      ...devices['Desktop Chrome'],
      userAgent: selectedUserAgent ?? devices['Desktop Chrome'].userAgent,
    });
    console.log('Browser context created');
    this.page = await context.newPage();
    console.log('New page created');
  }

  async close(): Promise<void> {
    await this.page
      ?.context()
      .close()
      .catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.browser = null;
  }

  private async navigate(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    console.log(`Navigating to ${this.config.url}`);
    await this.page.goto(this.config.url, {
      timeout: this.config.timeoutMs ?? 30000,
      waitUntil: 'domcontentloaded',
    });
    const selectors = Array.isArray(this.config.waitFor)
      ? this.config.waitFor
      : [this.config.waitFor];
    const timeout = this.config.timeoutMs ?? 30000;
    // Wait for the first selector that appears
    const page = this.page;
    await Promise.race(
      selectors.map(sel => page.waitForSelector(sel, { timeout }))
    );
  }

  async scrape(_existingHashes?: Set<string>): Promise<ExtractedRow[]> {
    if (!this.page) throw new Error('Page not initialized');
    await this.navigate();

    console.log('Starting pagination...');
    const pagination = new PaginationHandler(this.page, this.config.pagination);
    await pagination.run();
    console.log('Pagination completed');

    console.log('Extracting data...');
    const extracted = await this.page.evaluate(selectors => {
      /* eslint-disable no-undef */
      const result = {} as Record<string, string | string[] | undefined>;
      for (const s of selectors) {
        const list = document.querySelectorAll(s.selector);
        if (s.multiple) {
          const values: string[] = [];
          list.forEach((el: Element) => {
            const node = el as HTMLElement;
            let raw = '';
            if (s.type === 'text') raw = node.textContent ?? '';
            else if (s.type === 'html') raw = node.innerHTML;
            else if (s.type === 'attribute')
              raw = node.getAttribute(s.attribute ?? '') ?? '';
            if (s.transform === 'trim') raw = raw.trim();
            else if (s.transform === 'lowercase') raw = raw.toLowerCase();
            else if (s.transform === 'uppercase') raw = raw.toUpperCase();
            if (raw !== '') values.push(raw);
          });
          result[s.name] = values;
        } else {
          const el = list.item(0) as HTMLElement | null;
          if (!el) {
            result[s.name] = undefined;
            continue;
          }
          let raw = '';
          if (s.type === 'text') raw = el.textContent ?? '';
          else if (s.type === 'html') raw = el.innerHTML;
          else if (s.type === 'attribute')
            raw = el.getAttribute(s.attribute ?? '') ?? '';
          if (s.transform === 'trim') raw = raw.trim();
          else if (s.transform === 'lowercase') raw = raw.toLowerCase();
          else if (s.transform === 'uppercase') raw = raw.toUpperCase();
          result[s.name] = raw;
        }
      }
      /* eslint-enable no-undef */
      return result;
    }, this.config.selectors);

    // Shape to array of rows: zip arrays for multiple selectors
    const record = extracted as Record<string, string | string[] | undefined>;
    const fieldNames = Object.keys(record);
    const maxLen = fieldNames.reduce((acc, name) => {
      const v = record[name];
      return Array.isArray(v) ? Math.max(acc, v.length) : Math.max(acc, 1);
    }, 0);
    const rows: ExtractedRow[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: ExtractedRow = {};
      for (const name of fieldNames) {
        const v = record[name];
        row[name] = Array.isArray(v) ? v[i] : (v as string | undefined);
      }
      rows.push(row);
    }
    return rows;
  }
}
