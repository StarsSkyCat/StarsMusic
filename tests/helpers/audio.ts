import { writeFile } from 'node:fs/promises';

// 测试现场生成的静音 PCM，不包含第三方音频资产。
export async function writeSilentWav(filename: string, seconds = 30): Promise<void> {
  const sampleRate = 8000;
  const bytes = Math.floor(sampleRate * seconds) * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  await writeFile(filename, wav);
}
