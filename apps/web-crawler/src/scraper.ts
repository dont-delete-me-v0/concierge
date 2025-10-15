import path from 'node:path';
import {
  devices,
  type Browser,
  type LaunchOptions,
  type Page,
  type Response,
} from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { computeRowHash } from './incremental';
import { PaginationHandler } from './pagination';
import { ProxyManager, type ProxyConfig } from './proxyManager';
import type { ExtractedRow, ScraperConfig, SelectorConfig } from './types';
chromium.use(StealthPlugin());

let userAgentSequentialIndex = 0;

export class ConfigurableScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly config: ScraperConfig;
  private proxyManager: ProxyManager | null = null;
  private currentProxy: ProxyConfig | null = null;
  private currentUserAgent: string | undefined = undefined;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    console.log('Initializing browser...');

    // Load proxies if proxyFile is specified
    if (this.config.proxyFile) {
      this.proxyManager = new ProxyManager();
      const proxyPath = path.isAbsolute(this.config.proxyFile)
        ? this.config.proxyFile
        : path.join(process.cwd(), this.config.proxyFile);
      await this.proxyManager.loadProxies(proxyPath);

      if (this.proxyManager.hasProxies()) {
        // Get first proxy
        this.currentProxy =
          this.config.proxyRotation === 'random'
            ? this.proxyManager.getRandom()
            : this.proxyManager.getNext();
      }
    }

    await this.initBrowser();
  }

  private async initBrowser(): Promise<void> {
    // Determine proxy
    let proxyConfig:
      | { server: string; username?: string; password?: string }
      | undefined;

    if (this.currentProxy) {
      // Important: Playwright requires proxy server WITHOUT auth in URL
      // Auth credentials are passed separately
      proxyConfig = {
        server: `http://${this.currentProxy.host}:${this.currentProxy.port}`,
        username: this.currentProxy.username,
        password: this.currentProxy.password,
      };
      console.log(
        `Using proxy: ${this.currentProxy.host}:${this.currentProxy.port}${this.currentProxy.username ? ' (with auth)' : ''}`
      );
    } else if (this.config.proxyServer) {
      proxyConfig = { server: this.config.proxyServer };
      console.log(`Using proxy server: ${this.config.proxyServer}`);
    }

    const launchOptions: LaunchOptions = {
      headless: this.config.headless ?? false,
      proxy: proxyConfig,
      timeout: this.config.timeoutMs ?? 30000,
    };

    console.log('Launch options:', {
      headless: launchOptions.headless,
      timeout: launchOptions.timeout,
      proxy: proxyConfig
        ? {
            server: proxyConfig.server,
            hasAuth: !!(proxyConfig.username && proxyConfig.password),
          }
        : undefined,
    });
    this.browser = await chromium.launch(launchOptions);
    console.log('Browser launched successfully');

    // Select user agent
    this.currentUserAgent = this.selectUserAgent();

    const context = await this.browser.newContext({
      ...devices['Desktop Chrome'],
      userAgent: this.currentUserAgent ?? devices['Desktop Chrome'].userAgent,
      // Ignore HTTPS errors that might occur with some proxies
      ignoreHTTPSErrors: true,
    });
    console.log('Browser context created');

    this.page = await context.newPage();

    // Note: Proxy authentication is configured at browser launch level
    // via launchOptions.proxy.username/password
    if (this.currentProxy?.username && this.currentProxy?.password) {
      console.log('Using proxy with authentication');
    }

    // Add response listener for error detection
    this.page.on('response', (response: Response) => {
      this.handleResponse(response);
    });

    console.log('New page created');
  }

  private selectUserAgent(): string | undefined {
    const configuredUserAgents = this.config.userAgents ?? [];
    if (configuredUserAgents.length === 0) {
      return undefined;
    }

    if ((this.config.userAgentRotation ?? 'random') === 'sequential') {
      const ua =
        configuredUserAgents[
          userAgentSequentialIndex % configuredUserAgents.length
        ];
      userAgentSequentialIndex =
        (userAgentSequentialIndex + 1) % configuredUserAgents.length;
      return ua;
    } else {
      const idx = Math.floor(Math.random() * configuredUserAgents.length);
      return configuredUserAgents[idx];
    }
  }

  private handleResponse(response: Response): void {
    const status = response.status();
    const url = response.url();

    // Check for problematic status codes
    const retryStatusCodes = this.config.retryOnStatusCodes ?? [429, 503, 403];

    if (retryStatusCodes.includes(status)) {
      console.warn(`⚠️  Received status ${status} from ${url}`);

      if (status === 429) {
        console.warn(
          'Rate limit detected (429). Will rotate proxy/user-agent on next retry.'
        );
      } else if (status === 403) {
        console.warn(
          'Forbidden (403). Possible bot detection. Will rotate proxy/user-agent on next retry.'
        );
      }
    }
  }

  async rotateProxyAndUserAgent(): Promise<void> {
    console.log('🔄 Rotating proxy and user-agent...');

    // Mark current proxy as potentially failed
    if (this.currentProxy && this.proxyManager) {
      this.proxyManager.markFailed(this.currentProxy);
    }

    // Get new proxy
    if (this.proxyManager && this.proxyManager.hasProxies()) {
      this.currentProxy =
        this.config.proxyRotation === 'random'
          ? this.proxyManager.getRandom()
          : this.proxyManager.getNext();

      if (this.currentProxy) {
        console.log(
          `Switched to proxy: ${this.proxyManager.getProxyKey(this.currentProxy)}`
        );
      }
    }

    // Close current browser
    await this.close();

    // Reinitialize with new proxy
    await this.initBrowser();

    console.log('✅ Proxy and user-agent rotated successfully');
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

    try {
      const response = await this.page.goto(this.config.url, {
        timeout: this.config.timeoutMs ?? 30000,
        waitUntil: 'domcontentloaded',
      });

      // Check response status
      if (response) {
        const status = response.status();
        const headers = response.headers();
        console.log(`Response: ${status} ${response.statusText()}`);

        // Log useful headers for debugging
        if (headers['cf-ray']) {
          console.log(`Cloudflare Ray ID: ${headers['cf-ray']}`);
        }
        if (headers['x-proxy-id']) {
          console.log(`Proxy ID: ${headers['x-proxy-id']}`);
        }

        const retryStatusCodes = this.config.retryOnStatusCodes ?? [
          429, 503, 403,
        ];

        if (retryStatusCodes.includes(status)) {
          throw new Error(
            `Navigation failed with status ${status}: ${response.statusText()}`
          );
        }
      } else {
        console.warn(
          'No response received (might be a timeout or network error)'
        );
      }

      const selectors = Array.isArray(this.config.waitFor)
        ? this.config.waitFor
        : [this.config.waitFor];
      const timeout = this.config.timeoutMs ?? 30000;
      // Wait for the first selector that appears
      const page = this.page;
      await Promise.race(
        selectors.map(sel => page.waitForSelector(sel, { timeout }))
      );
      console.log('✅ Page loaded and selectors found');
    } catch (err) {
      const errorMsg = (err as Error)?.message ?? String(err);
      console.error('❌ Navigation error:', errorMsg);

      // Add more context for common errors
      if (errorMsg.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
        console.error(
          '💡 Proxy connection failed - check proxy credentials and connectivity'
        );
      } else if (errorMsg.includes('ERR_PROXY_CONNECTION_FAILED')) {
        console.error(
          '💡 Cannot connect to proxy server - check if proxy is online'
        );
      } else if (errorMsg.includes('Timeout')) {
        console.error(
          '💡 Navigation timeout - site might be slow or blocking the request'
        );
      }

      throw err;
    }
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
            if (!this.page || this.page.isClosed()) {
              console.warn('Main page is closed, skipping enrichment');
              continue;
            }
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
            if (!this.page || this.page.isClosed()) {
              console.warn('Main page is closed, skipping enrichment');
              continue;
            }
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
        } catch (err) {
          const errorMsg = (err as Error)?.message ?? String(err);
          console.warn(
            `Failed to enrich item ${idx} (${href ?? 'no link'}): ${errorMsg}`
          );
          // Continue with next item
        }
      }
    };
    for (let i = 0; i < concurrency; i++) workers.push(runWorker());
    await Promise.all(workers);
    return rows;
  }
}
