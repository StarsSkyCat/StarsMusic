// 已验证的酷狗标准版媒体端点。平台/渠道扩展须增加独立证据，不能放行整个官方域名。
export function allowedKugouMediaHost(host: string): boolean {
  return ['fsandroid.kugou.com', 'fsandroid.tx.kugou.com', 'fsmobile.kugou.com', 'fsmobile.tx.kugou.com'].includes(host);
}
