import { constants, createHash, publicEncrypt } from 'node:crypto';
import { DomainError } from '../../../contracts/src/errors.ts';

// 标准版公开协议常量，来源/固定提交及 MIT 声明见 THIRD_PARTY_NOTICES.md。
const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB
-----END PUBLIC KEY-----`;
export function md5(value: string): string { return createHash('md5').update(value).digest('hex'); }
export function signature(params: Record<string, string>, body: string, web: boolean): string {
  const salt = web ? 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt' : 'OIlwieks28dk2k092lksi2UIkp';
  return md5(salt + Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('') + body + salt);
}
export function accountProof(token: string, time: number): string {
  const data = Buffer.from(JSON.stringify({ token, clienttime: time }));
  if (data.length > 128) throw new DomainError('invalid-response');
  const padded = Buffer.alloc(128); data.copy(padded);
  return publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, padded).toString('hex').toUpperCase();
}
export function registerProof(data: object): string {
  return publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(JSON.stringify(data))).toString('hex');
}
