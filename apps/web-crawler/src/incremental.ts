import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChangeRecord, ExtractedRow, IncrementalState } from './types';

export function buildKeyString(row: ExtractedRow, uniqueKey: string[]): string {
  const parts = uniqueKey.map(name => (row[name] ?? '').toString());
  return parts.join('|');
}

export function hashKeyString(keyString: string): string {
  return crypto.createHash('sha256').update(keyString).digest('hex');
}

export function computeRowHash(row: ExtractedRow, uniqueKey: string[]): string {
  return hashKeyString(buildKeyString(row, uniqueKey));
}

export async function loadIncrementalState(
  filePath: string
): Promise<IncrementalState | null> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  try {
    const content = await fs.readFile(abs, 'utf8');
    return JSON.parse(content) as IncrementalState;
  } catch {
    return null;
  }
}

export async function saveIncrementalState(
  filePath: string,
  state: IncrementalState
): Promise<void> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const dir = path.dirname(abs);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(abs, JSON.stringify(state, null, 2), 'utf8');
}

export function diffRows(
  oldRow: ExtractedRow,
  newRow: ExtractedRow,
  uniqueKey: string[]
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  const now = new Date().toISOString();
  const examinedFields = new Set<string>([
    ...Object.keys(oldRow),
    ...Object.keys(newRow),
  ]);
  for (const field of examinedFields) {
    if (uniqueKey.includes(field)) continue; // ignore keys used for identity
    const oldValue = oldRow[field];
    const newValue = newRow[field];
    if (oldValue !== newValue) {
      changes.push({ timestamp: now, field, oldValue, newValue });
    }
  }
  return changes;
}
