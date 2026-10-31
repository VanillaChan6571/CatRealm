import { describe, expect, it } from 'vitest';
import { isArchiveFile, isArchiveMime } from '../archiveFiles';

describe('archive detection', () => {
  it('accepts archive MIME types and untyped archive extensions only', () => {
    expect(isArchiveFile({ name: 'pack.zip', type: 'application/x-zip-compressed' })).toBe(true);
    expect(isArchiveFile({ name: 'saves.RAR', type: '' })).toBe(true);
    expect(isArchiveFile({ name: 'big.7z', type: 'application/octet-stream' })).toBe(true);
    expect(isArchiveFile({ name: 'evil.zip', type: 'text/html' })).toBe(false);
    expect(isArchiveFile({ name: 'setup.exe', type: '' })).toBe(false);
    expect(isArchiveMime('application/vnd.rar')).toBe(true);
    expect(isArchiveMime('image/png')).toBe(false);
  });
});
