export interface InvokeSource {
  sender: unknown;
  senderFrame: { url: string } | null;
}

export function assertTrustedSource(
  source: InvokeSource,
  expectedSender: unknown,
  mainFrame: unknown,
  documentUrl: string,
): void {
  if (!expectedSender || !mainFrame || source.sender !== expectedSender
    || source.senderFrame !== mainFrame || source.senderFrame?.url !== documentUrl) {
    throw new Error('不允许的 IPC 来源');
  }
}

export function assertTrustedInvoke(
  source: InvokeSource, expectedSender: unknown, mainFrame: unknown,
  documentUrl: string, args: readonly unknown[],
): void {
  assertTrustedSource(source, expectedSender, mainFrame, documentUrl);
  if (args.length !== 0) throw new Error('此命令不接受参数');
}

export function getDevelopmentUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '5173'
    || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('开发页面必须为 http://127.0.0.1:5173/');
  }
  return url.href;
}
