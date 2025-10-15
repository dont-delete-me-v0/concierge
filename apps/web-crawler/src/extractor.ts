import type { SelectorConfig, TransformType } from './types';

function applyTransform(value: string, transform?: TransformType): string {
  if (transform === 'trim') return value.trim();
  if (transform === 'lowercase') return value.toLowerCase();
  if (transform === 'uppercase') return value.toUpperCase();
  return value;
}

export class DataExtractor {
  public extractFromDocument(
    selectors: SelectorConfig[]
  ): Record<string, string | string[] | undefined> {
    const result: Record<string, string | string[] | undefined> = {};
    for (const s of selectors) {
      const nodeList = document.querySelectorAll<HTMLElement>(s.selector);
      if (s.multiple) {
        const values: string[] = [];
        nodeList.forEach(el => {
          let raw = '';
          if (s.type === 'text') raw = el.textContent ?? '';
          else if (s.type === 'html') raw = el.innerHTML;
          else if (s.type === 'attribute')
            raw = el.getAttribute(s.attribute ?? '') ?? '';
          const transformed = applyTransform(raw, s.transform);
          if (transformed !== '') values.push(transformed);
        });
        result[s.name] = values;
      } else {
        const el = nodeList.item(0);
        if (!el) {
          result[s.name] = undefined;
          continue;
        }
        let raw = '';
        if (s.type === 'text') raw = el.textContent ?? '';
        else if (s.type === 'html') raw = el.innerHTML;
        else if (s.type === 'attribute')
          raw = el.getAttribute(s.attribute ?? '') ?? '';
        result[s.name] = applyTransform(raw, s.transform);
      }
    }
    return result;
  }
}
