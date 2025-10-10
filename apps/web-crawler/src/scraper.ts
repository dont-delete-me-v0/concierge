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
import type { ExtractedRow, ScraperConfig, SelectorConfig } from './types.js';
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

  private async waitSelectorStable(
    page: Page,
    selectorCfg: SelectorConfig,
    timeout: number
  ): Promise<void> {
    const sel = selectorCfg.selector;
    try {
      await page.waitForSelector(sel, { timeout });
    } catch {
      return;
    }
    try {
      // Use a shorter timeout for the content-filled stability check to avoid tabs hanging too long
      const checkTimeout = Math.max(500, Math.min(timeout, 5000));
      if (selectorCfg.type === 'attribute') {
        const attr = selectorCfg.attribute || '';
        await page.waitForFunction(
          (args: { css: string; attr: string }) => {
            const el = document.querySelector(args.css) as HTMLElement | null;
            const val = el?.getAttribute(args.attr || '') || '';
            return val.replace(/\u00A0/g, ' ').trim().length > 0;
          },
          { css: sel, attr },
          { timeout: checkTimeout }
        );
      } else {
        await page.waitForFunction(
          (css: string) => {
            const el = document.querySelector(css) as HTMLElement | null;
            const txt = (el?.textContent || el?.innerHTML || '')
              .replace(/\u00A0/g, ' ')
              .trim();
            return txt.length > 0;
          },
          sel,
          { timeout: checkTimeout }
        );
      }
    } catch {}
  }

  async scrape(_existingHashes?: Set<string>): Promise<ExtractedRow[]> {
    if (!this.page) throw new Error('Page not initialized');
    await this.navigate();

    console.log('Starting pagination...');
    const pagination = new PaginationHandler(this.page, this.config.pagination);
    await pagination.run();
    console.log('Pagination completed');

    console.log('Extracting data...');
    {
      const waitTimeout = this.config.timeoutMs ?? 30000;
      for (const s of this.config.selectors as SelectorConfig[]) {
        await this.waitSelectorStable(this.page, s, waitTimeout);
      }
    }

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
            if (s.transform === 'trim')
              raw = raw
                .replace(/\u00A0/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
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
          if (s.transform === 'trim')
            raw = raw
              .replace(/\u00A0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
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
    // Optionally enrich with details
    if (!this.page) return rows;
    const detailsCfg = this.config.details;
    if (!detailsCfg) return rows;

    const concurrency = Math.max(
      1,
      Math.min(detailsCfg.maxConcurrency ?? 3, 8)
    );
    const timeout = detailsCfg.timeoutMs ?? this.config.timeoutMs ?? 30000;
    const waitFor = Array.isArray(detailsCfg.waitFor)
      ? detailsCfg.waitFor
      : detailsCfg.waitFor
        ? [detailsCfg.waitFor]
        : [];

    // Determine targets: prefer link field if present, otherwise use click selector workflow
    const targets: Array<{ idx: number; href?: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      const href = rows[i].link;
      if (href) targets.push({ idx: i, href });
      else targets.push({ idx: i });
    }

    console.log(
      `Enriching ${targets.length} items with details (concurrency=${concurrency})`
    );
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const runWorker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const { idx, href } = targets[cursor++];
        try {
          let details: Record<string, string | undefined> | undefined;
          if (href) {
            // Open new tab to the href
            if (!this.page) continue; // type guard
            const context = this.page.context();
            const p = await context.newPage();
            try {
              const absHref = (() => {
                try {
                  return new URL(href, this.config.url).toString();
                } catch {
                  return href;
                }
              })();
              await p.goto(absHref, { timeout, waitUntil: 'domcontentloaded' });
              for (const sel of waitFor)
                await p
                  .waitForSelector(sel, { timeout })
                  .catch(() => undefined);
              for (const s of detailsCfg.selectors)
                await this.waitSelectorStable(p, s as SelectorConfig, timeout);
              details = await p.evaluate(selectors => {
                /* eslint-disable no-undef */
                const out = {} as Record<string, string | undefined>;
                for (const s of selectors) {
                  const list = document.querySelectorAll(s.selector);
                  if (s.multiple) {
                    // join multiple into single text for details
                    const values: string[] = [];
                    list.forEach((el: Element) => {
                      const node = el as HTMLElement;
                      let raw = '';
                      if (s.type === 'text') raw = node.textContent ?? '';
                      else if (s.type === 'html') raw = node.innerHTML;
                      else if (s.type === 'attribute')
                        raw = node.getAttribute(s.attribute ?? '') ?? '';
                      if (s.transform === 'trim')
                        raw = raw
                          .replace(/\u00A0/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();
                      else if (s.transform === 'lowercase')
                        raw = raw.toLowerCase();
                      else if (s.transform === 'uppercase')
                        raw = raw.toUpperCase();
                      if (raw !== '') values.push(raw);
                    });
                    out[s.name] = values.join('\n');
                  } else {
                    const el = list.item(0) as HTMLElement | null;
                    if (!el) {
                      out[s.name] = undefined;
                      continue;
                    }
                    let raw = '';
                    if (s.type === 'text') raw = el.textContent ?? '';
                    else if (s.type === 'html') raw = el.innerHTML;
                    else if (s.type === 'attribute')
                      raw = el.getAttribute(s.attribute ?? '') ?? '';
                    if (s.transform === 'trim')
                      raw = raw
                        .replace(/\u00A0/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    else if (s.transform === 'lowercase')
                      raw = raw.toLowerCase();
                    else if (s.transform === 'uppercase')
                      raw = raw.toUpperCase();
                    out[s.name] = raw;
                  }
                }
                return out;
                /* eslint-enable no-undef */
              }, detailsCfg.selectors);
            } finally {
              await p.close().catch(() => undefined);
            }
          } else if (detailsCfg.clickSelector) {
            // Click flow in same page via new tab opening
            if (!this.page) continue; // type guard
            const [newPage] = await Promise.all([
              this.page
                .context()
                .waitForEvent('page', { timeout })
                .catch(() => null),
              this.page
                .locator(detailsCfg.clickSelector)
                .nth(idx)
                .click({ timeout })
                .catch(() => undefined),
            ]);
            if (newPage) {
              try {
                for (const sel of waitFor)
                  await newPage
                    .waitForSelector(sel, { timeout })
                    .catch(() => undefined);
                for (const s of detailsCfg.selectors)
                  await this.waitSelectorStable(
                    newPage,
                    s as SelectorConfig,
                    timeout
                  );
                details = await newPage.evaluate(selectors => {
                  /* eslint-disable no-undef */
                  const out = {} as Record<string, string | undefined>;
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
                        if (s.transform === 'trim')
                          raw = raw
                            .replace(/\u00A0/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        else if (s.transform === 'lowercase')
                          raw = raw.toLowerCase();
                        else if (s.transform === 'uppercase')
                          raw = raw.toUpperCase();
                        if (raw !== '') values.push(raw);
                      });
                      out[s.name] = values.join('\n');
                    } else {
                      const el = list.item(0) as HTMLElement | null;
                      if (!el) {
                        out[s.name] = undefined;
                        continue;
                      }
                      let raw = '';
                      if (s.type === 'text') raw = el.textContent ?? '';
                      else if (s.type === 'html') raw = el.innerHTML;
                      else if (s.type === 'attribute')
                        raw = el.getAttribute(s.attribute ?? '') ?? '';
                      if (s.transform === 'trim')
                        raw = raw
                          .replace(/\u00A0/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();
                      else if (s.transform === 'lowercase')
                        raw = raw.toLowerCase();
                      else if (s.transform === 'uppercase')
                        raw = raw.toUpperCase();
                      out[s.name] = raw;
                    }
                  }
                  return out;
                  /* eslint-enable no-undef */
                }, detailsCfg.selectors);
              } finally {
                await newPage.close().catch(() => undefined);
              }
            }
          }
          if (details) {
            for (const [k, v] of Object.entries(details)) rows[idx][k] = v;
          }
        } catch {
          // ignore per-item errors
        }
      }
    };
    for (let i = 0; i < concurrency; i++) workers.push(runWorker());
    await Promise.all(workers);
    return rows;
  }
}
