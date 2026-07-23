import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

/**
 * 就地更新 .env 文件里的若干 KEY=VALUE，保留注释、空行与其他键的原样。
 * 已存在的 key 就地替换；不存在的 key 追加到文件末尾。
 * @param {Record<string,string>} updates 例如 { CHAT_MODEL: 'gpt-4o', OPENAI_API_KEY: 'sk-...' }
 */
export function updateEnvFile(updates) {
  let text = '';
  try {
    text = readFileSync(envPath, 'utf-8');
  } catch {
    text = ''; // 文件不存在则新建
  }

  const keys = Object.keys(updates);
  const remaining = new Set(keys);
  const lines = text.split(/\r?\n/);

  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && remaining.has(m[1])) {
      remaining.delete(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });

  // 未在文件中出现的 key 追加到末尾
  for (const k of remaining) {
    // 避免在文件末尾堆叠空行
    if (out.length && out[out.length - 1].trim() === '') out.pop();
    out.push(`${k}=${updates[k]}`);
  }

  writeFileSync(envPath, out.join('\n'), 'utf-8');
}
