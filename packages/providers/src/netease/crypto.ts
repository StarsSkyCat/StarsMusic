// 协议格式与公开常量参考 api-enhanced 4.41.1；许可与来源见 THIRD_PARTY_NOTICES.md。
// 这些是协议常量，不是用户凭据；不能用于本地凭据加密。
import { constants, createCipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto';

const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

function cbc(input: string, key: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
  return Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]).toString('base64');
}
export function encodeWeapi(data: object): Record<string, string> {
  const secret = randomBytes(12).toString('base64url');
  const block = Buffer.alloc(128);
  Buffer.from([...secret].reverse().join('')).copy(block, 112);
  return {
    params: cbc(cbc(JSON.stringify(data), '0CoJUm6Qyw8W8jud'), secret),
    encSecKey: publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, block).toString('hex'),
  };
}
export function encodeEapi(uri: string, data: object): Record<string, string> {
  const json = JSON.stringify(data);
  const digest = createHash('md5').update(`nobody${uri}use${json}md5forencrypt`).digest('hex');
  const cipher = createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null);
  return { params: Buffer.concat([cipher.update(`${uri}-36cd479b6b5-${json}-36cd479b6b5-${digest}`, 'utf8'), cipher.final()]).toString('hex').toUpperCase() };
}
