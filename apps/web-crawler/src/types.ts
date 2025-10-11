export type PaginationType =
  | 'infinite-scroll'
  | 'load-more'
  | 'next-button'
  | 'none';

export type ExtractType = 'text' | 'attribute' | 'html';

export type TransformType = 'trim' | 'lowercase' | 'uppercase';

export type WaitPolicy = 'present' | 'visible' | 'non-empty';

export interface SelectorConfig {
  name: string;
  selector: string;
  type: ExtractType;
  attribute?: string;
  multiple?: boolean;
  transform?: TransformType;
  // Optional waiting hints to ensure content is loaded before extraction
  wait?: WaitPolicy; // present: in DOM; visible: intersecting/visible; non-empty: text/attr not empty
  required?: boolean; // if true, we'll wait (with timeout) for this selector to satisfy wait policy
}

export interface BasePaginationConfig {
  type: PaginationType;
  maxPages?: number;
  waitAfterAction?: number;
  scrollDelay?: number;
  selector?: string;
}

export interface DetailsConfig {
  clickSelector?: string;
  selectors: SelectorConfig[];
  waitFor?: string | string[];
  maxConcurrency?: number;
  timeoutMs?: number;
}

export interface ScraperConfig {
  url: string;
  source_base_url?: string;
  waitFor: string | string[];
  pagination?: BasePaginationConfig;
  selectors: SelectorConfig[];
  outputFile?: string;
  timeoutMs?: number;
  headless?: boolean;
  proxyServer?: string;
  retries?: number;
  userAgents?: string[];
  userAgentRotation?: 'random' | 'sequential';
  details?: DetailsConfig;
  incremental?: IncrementalConfig;
  // Optional static category to attach to every row
  category_name?: string;
}

export interface ExtractedRow {
  [key: string]: string | undefined;
}

export interface ValidationSuccess {
  ok: true;
  config: ScraperConfig;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface IncrementalConfig {
  enabled: boolean;
  uniqueKey?: string[];
  storageFile?: string;
  stopOnMatch?: boolean;
  trackChanges?: boolean;
  updateExisting?: boolean;
}

export interface ChangeRecord {
  timestamp: string;
  field: string;
  oldValue: string | undefined;
  newValue: string | undefined;
}

export interface IncrementalState {
  lastUpdate: string;
  totalItems: number;
  hashes: string[];
  // Present when trackChanges/updateExisting is enabled
  items?: Record<string, ExtractedRow & { changes?: ChangeRecord[] }>;
}

export function validateConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    errors.push('Config must be an object');
    return { ok: false, errors };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.url !== 'string' || obj.url.length === 0) {
    errors.push('"url" must be a non-empty string');
  }
  const waitFor = obj.waitFor as unknown;
  if (
    !(typeof waitFor === 'string' && waitFor.length > 0) &&
    !(
      Array.isArray(waitFor) &&
      waitFor.length > 0 &&
      waitFor.every(v => typeof v === 'string' && v.length > 0)
    )
  ) {
    errors.push(
      '"waitFor" must be a non-empty string or array of non-empty strings'
    );
  }

  const selectors = obj.selectors as unknown;
  if (!Array.isArray(selectors) || selectors.length === 0) {
    errors.push('"selectors" must be a non-empty array');
  } else {
    for (let i = 0; i < selectors.length; i++) {
      const s = selectors[i] as Record<string, unknown>;
      if (typeof s !== 'object' || s === null) {
        errors.push(`selectors[${i}] must be an object`);
        continue;
      }
      if (typeof s.name !== 'string' || s.name.length === 0) {
        errors.push(`selectors[${i}].name must be a non-empty string`);
      }
      if (typeof s.selector !== 'string' || s.selector.length === 0) {
        errors.push(`selectors[${i}].selector must be a non-empty string`);
      }
      if (s.type !== 'text' && s.type !== 'attribute' && s.type !== 'html') {
        errors.push(
          `selectors[${i}].type must be one of: text | attribute | html`
        );
      }
      if (
        s.type === 'attribute' &&
        (typeof s.attribute !== 'string' || s.attribute.length === 0)
      ) {
        errors.push(
          `selectors[${i}].attribute must be provided when type = "attribute"`
        );
      }
      if (
        s.transform !== undefined &&
        s.transform !== 'trim' &&
        s.transform !== 'lowercase' &&
        s.transform !== 'uppercase'
      ) {
        errors.push(
          `selectors[${i}].transform must be one of: trim | lowercase | uppercase`
        );
      }
      if (
        s.wait !== undefined &&
        s.wait !== 'present' &&
        s.wait !== 'visible' &&
        s.wait !== 'non-empty'
      ) {
        errors.push(
          `selectors[${i}].wait must be one of: present | visible | non-empty`
        );
      }
    }
  }

  if (obj.pagination !== undefined) {
    const p = obj.pagination as Record<string, unknown>;
    if (typeof p !== 'object' || p === null) {
      errors.push('"pagination" must be an object when provided');
    } else {
      const t = p.type as unknown;
      if (
        t !== 'infinite-scroll' &&
        t !== 'load-more' &&
        t !== 'next-button' &&
        t !== 'none'
      ) {
        errors.push(
          'pagination.type must be one of: infinite-scroll | load-more | next-button | none'
        );
      }
      if (
        (t === 'load-more' || t === 'next-button') &&
        (typeof p.selector !== 'string' || p.selector.length === 0)
      ) {
        errors.push(
          'pagination.selector must be provided for load-more or next-button'
        );
      }
      if (
        p.maxPages !== undefined &&
        (typeof p.maxPages !== 'number' ||
          !Number.isFinite(p.maxPages) ||
          p.maxPages < 0)
      ) {
        errors.push(
          'pagination.maxPages must be a non-negative number when provided (omit for unlimited)'
        );
      }
      if (
        p.scrollDelay !== undefined &&
        (typeof p.scrollDelay !== 'number' || p.scrollDelay < 0)
      ) {
        errors.push(
          'pagination.scrollDelay must be a non-negative number when provided'
        );
      }
      if (
        p.waitAfterAction !== undefined &&
        (typeof p.waitAfterAction !== 'number' || p.waitAfterAction < 0)
      ) {
        errors.push(
          'pagination.waitAfterAction must be a non-negative number when provided'
        );
      }
    }
  }

  // incremental validation
  const outputFileInput =
    (obj.outputFile as string | undefined) ?? 'results.json';
  const defaultStorageFile = outputFileInput.endsWith('.json')
    ? outputFileInput.replace(/\.json$/i, '-state.json')
    : `${outputFileInput}-state.json`;

  const inc = obj.incremental as Record<string, unknown> | undefined;
  if (inc !== undefined && (typeof inc !== 'object' || inc === null)) {
    errors.push('"incremental" must be an object when provided');
  }

  const enabledInc = Boolean(
    inc && typeof inc.enabled === 'boolean' ? (inc.enabled as boolean) : false
  );

  if (enabledInc) {
    const uniqueKey = inc?.uniqueKey as unknown;
    if (!Array.isArray(uniqueKey) || uniqueKey.length === 0) {
      errors.push(
        'incremental.uniqueKey must be a non-empty array when enabled'
      );
    } else {
      const selectorNames = new Set(
        ((obj.selectors as unknown as SelectorConfig[]) || []).map(s => s.name)
      );
      for (let i = 0; i < uniqueKey.length; i++) {
        const k = uniqueKey[i];
        if (typeof k !== 'string' || k.length === 0) {
          errors.push(`incremental.uniqueKey[${i}] must be a non-empty string`);
        } else if (!selectorNames.has(k)) {
          errors.push(
            `incremental.uniqueKey[${i}] refers to unknown selector name: ${k}`
          );
        }
      }
    }
    if (
      inc?.storageFile !== undefined &&
      (typeof inc.storageFile !== 'string' || inc.storageFile.length === 0)
    ) {
      errors.push(
        'incremental.storageFile must be a non-empty string when provided'
      );
    }
    if (
      inc?.stopOnMatch !== undefined &&
      typeof inc.stopOnMatch !== 'boolean'
    ) {
      errors.push('incremental.stopOnMatch must be a boolean when provided');
    }
    if (
      inc?.trackChanges !== undefined &&
      typeof inc.trackChanges !== 'boolean'
    ) {
      errors.push('incremental.trackChanges must be a boolean when provided');
    }
    if (
      inc?.updateExisting !== undefined &&
      typeof inc.updateExisting !== 'boolean'
    ) {
      errors.push('incremental.updateExisting must be a boolean when provided');
    }
  }

  if (
    obj.outputFile !== undefined &&
    (typeof obj.outputFile !== 'string' || obj.outputFile.length === 0)
  ) {
    errors.push('"outputFile" must be a non-empty string when provided');
  }
  if (
    obj.timeoutMs !== undefined &&
    (typeof obj.timeoutMs !== 'number' || obj.timeoutMs <= 0)
  ) {
    errors.push('"timeoutMs" must be a positive number when provided');
  }
  if (obj.headless !== undefined && typeof obj.headless !== 'boolean') {
    errors.push('"headless" must be a boolean when provided');
  }
  if (
    obj.category_name !== undefined &&
    (typeof obj.category_name !== 'string' ||
      obj.category_name.trim().length === 0)
  ) {
    errors.push('"category_name" must be a non-empty string when provided');
  }
  if (
    obj.proxyServer !== undefined &&
    (typeof obj.proxyServer !== 'string' || obj.proxyServer.length === 0)
  ) {
    errors.push('"proxyServer" must be a non-empty string when provided');
  }
  if (
    obj.retries !== undefined &&
    (typeof obj.retries !== 'number' || obj.retries < 0)
  ) {
    errors.push('"retries" must be a non-negative number when provided');
  }

  // user-agent options validation
  if (obj.userAgents !== undefined) {
    const ua = obj.userAgents as unknown;
    if (!Array.isArray(ua) || ua.length === 0) {
      errors.push(
        '"userAgents" must be a non-empty array of strings when provided'
      );
    } else if (!ua.every(v => typeof v === 'string' && v.length > 0)) {
      errors.push('"userAgents" must contain only non-empty strings');
    }
  }
  if (obj.userAgentRotation !== undefined) {
    const rot = obj.userAgentRotation as unknown;
    if (rot !== 'random' && rot !== 'sequential') {
      errors.push('"userAgentRotation" must be one of: random | sequential');
    }
  }

  // details validation
  if (obj.details !== undefined) {
    const d = obj.details as Record<string, unknown>;
    if (typeof d !== 'object' || d === null) {
      errors.push('"details" must be an object when provided');
    } else {
      const ds = d.selectors as unknown;
      if (!Array.isArray(ds) || ds.length === 0) {
        errors.push('details.selectors must be a non-empty array');
      } else {
        for (let i = 0; i < ds.length; i++) {
          const s = ds[i] as Record<string, unknown>;
          if (typeof s !== 'object' || s === null) {
            errors.push(`details.selectors[${i}] must be an object`);
            continue;
          }
          if (typeof s.name !== 'string' || s.name.length === 0) {
            errors.push(
              `details.selectors[${i}].name must be a non-empty string`
            );
          }
          if (typeof s.selector !== 'string' || s.selector.length === 0) {
            errors.push(
              `details.selectors[${i}].selector must be a non-empty string`
            );
          }
          if (
            s.type !== 'text' &&
            s.type !== 'attribute' &&
            s.type !== 'html'
          ) {
            errors.push(
              `details.selectors[${i}].type must be one of: text | attribute | html`
            );
          }
          if (
            s.type === 'attribute' &&
            (typeof s.attribute !== 'string' || s.attribute.length === 0)
          ) {
            errors.push(
              `details.selectors[${i}].attribute must be provided when type = "attribute"`
            );
          }
          if (
            s.transform !== undefined &&
            s.transform !== 'trim' &&
            s.transform !== 'lowercase' &&
            s.transform !== 'uppercase'
          ) {
            errors.push(
              `details.selectors[${i}].transform must be one of: trim | lowercase | uppercase`
            );
          }
          if (
            s.wait !== undefined &&
            s.wait !== 'present' &&
            s.wait !== 'visible' &&
            s.wait !== 'non-empty'
          ) {
            errors.push(
              `details.selectors[${i}].wait must be one of: present | visible | non-empty`
            );
          }
        }
      }
      if (
        d.maxConcurrency !== undefined &&
        (typeof d.maxConcurrency !== 'number' || d.maxConcurrency <= 0)
      ) {
        errors.push(
          'details.maxConcurrency must be a positive number when provided'
        );
      }
      if (
        d.timeoutMs !== undefined &&
        (typeof d.timeoutMs !== 'number' || d.timeoutMs <= 0)
      ) {
        errors.push(
          'details.timeoutMs must be a positive number when provided'
        );
      }
      if (
        d.waitFor !== undefined &&
        !(
          (typeof d.waitFor === 'string' && d.waitFor.length > 0) ||
          (Array.isArray(d.waitFor) &&
            d.waitFor.length > 0 &&
            d.waitFor.every(v => typeof v === 'string' && v.length > 0))
        )
      ) {
        errors.push(
          'details.waitFor must be a non-empty string or array of non-empty strings when provided'
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const normalized: ScraperConfig = {
    url: obj.url as string,
    source_base_url: (obj.source_base_url as string | undefined) ?? undefined,
    waitFor: (Array.isArray(waitFor) ? waitFor : (waitFor as string)) as
      | string
      | string[],
    pagination: obj.pagination as BasePaginationConfig | undefined,
    selectors: selectors as SelectorConfig[],
    outputFile: (obj.outputFile as string | undefined) ?? 'results.json',
    timeoutMs: (obj.timeoutMs as number | undefined) ?? 30000,
    headless: (obj.headless as boolean | undefined) ?? true,
    proxyServer: obj.proxyServer as string | undefined,
    retries: (obj.retries as number | undefined) ?? 0,
    userAgents: (obj.userAgents as string[] | undefined) ?? undefined,
    userAgentRotation:
      (obj.userAgentRotation as 'random' | 'sequential' | undefined) ??
      'random',
    details: obj.details as DetailsConfig | undefined,
    incremental: {
      enabled: enabledInc,
      uniqueKey: (inc?.uniqueKey as string[] | undefined) ?? undefined,
      storageFile:
        (inc?.storageFile as string | undefined) ?? defaultStorageFile,
      stopOnMatch: (inc?.stopOnMatch as boolean | undefined) ?? true,
      trackChanges: (inc?.trackChanges as boolean | undefined) ?? false,
      updateExisting: (inc?.updateExisting as boolean | undefined) ?? false,
    },
    category_name: (obj.category_name as string | undefined) ?? undefined,
  };

  return { ok: true, config: normalized };
}
