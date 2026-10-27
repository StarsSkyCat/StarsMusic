import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { kugouTrackPageSize } from '../../../contracts/src/kugou.ts';
import { DomainError } from '../../../contracts/src/errors.ts';
import { record, text } from '../../../contracts/src/validation.ts';
import { parseApiJson } from '../api-json.ts';
import { accountProof, md5, registerProof, signature } from './crypto.ts';

export const kugouProtocolBaseline = 'kugoumusicapi@1.6.2/62730f900dc9fdc51396a663b3d33a6c4c704046';
export type KugouEndpoint = 'qrKey' | 'qrPoll' | 'account' | 'playlists' | 'playlist' | 'stream' | 'resource' | 'register' | 'searchSongs' | 'searchPlaylists' | 'publicPlaylists' | 'publicPlaylist';
export interface KugouTransportSession {
  readonly userid: string;
  readonly token: string;
  readonly dfid: string;
  readonly guid: string;
}
export interface KugouTransport {
  call(endpoint: KugouEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  acceptIdentity(userid: string, token: string): void;
  exportSession(): KugouTransportSession | undefined;
  restoreSession(session: KugouTransportSession): void;
  clear(): void;
}
const endpoints: Record<KugouEndpoint, readonly [string, string | undefined]> = {
  qrKey: ['https://login-user.kugou.com/v2/qrcode', undefined],
  qrPoll: ['https://login-user.kugou.com/v2/get_userinfo_qrcode', undefined],
  account: ['https://gateway.kugou.com/v3/get_my_info', 'usercenter.kugou.com'],
  playlists: ['https://gateway.kugou.com/v7/get_all_list', 'cloudlist.service.kugou.com'],
  playlist: ['https://gateway.kugou.com/v4/get_list_all_file_v3', 'cloudlist.service.kugou.com'],
  stream: ['https://gateway.kugou.com/v5/url', 'trackercdn.kugou.com'],
  resource: ['https://gateway.kugou.com/v2/get_res_privilege/lite', 'media.store.kugou.com'],
  register: ['https://userservice.kugou.com/risk/v3/r_register_dev', undefined],
  searchSongs: ['https://gateway.kugou.com/v2/search/song', 'complexsearch.kugou.com'],
  searchPlaylists: ['https://gateway.kugou.com/v1/search/special', 'complexsearch.kugou.com'],
  publicPlaylists: ['https://gateway.kugou.com/v2/special_recommend', 'specialrec.service.kugou.com'],
  publicPlaylist: ['https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt', undefined],
};

export class DirectKugouTransport implements KugouTransport {
  // App 协议使用由 GUID 派生的十进制大整数 MID；全程按字符串处理，不转 Number。
  #guid: string = randomUUID();
  #mid = BigInt(`0x${md5(this.#guid)}`).toString();
  #userid = '';
  #token = '';
  #dfid = '-';
  #epoch = 0;
  acceptIdentity(userid: string, token: string): void {
    if (!/^\d{1,30}$/.test(userid) || !/^[A-Za-z0-9_-]{1,96}$/.test(token)) throw new DomainError('invalid-response');
    this.#userid = userid; this.#token = token;
  }
  exportSession(): KugouTransportSession | undefined {
    if (!this.#userid || !this.#token) return undefined;
    return Object.freeze({ userid: this.#userid, token: this.#token, dfid: this.#dfid, guid: this.#guid });
  }
  restoreSession(session: KugouTransportSession): void {
    if (!/^\d{1,30}$/.test(session.userid) || !/^[A-Za-z0-9_-]{1,96}$/.test(session.token)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(session.dfid) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(session.guid)) {
      throw new DomainError('invalid-response');
    }
    this.#epoch++;
    this.#guid = session.guid; this.#mid = BigInt(`0x${md5(this.#guid)}`).toString();
    this.#dfid = session.dfid; this.#userid = session.userid; this.#token = session.token;
  }
  clear(): void { this.#epoch++; this.#userid = ''; this.#token = ''; this.#dfid = '-'; }
  async call(endpoint: KugouEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const epoch = this.#epoch;
    const time = Math.floor(Date.now() / 1000);
    const params: Record<string, string> = { dfid: this.#dfid, mid: this.#mid, uuid: '-', appid: '1005', clientver: '20489', clienttime: String(time),
      ...(this.#token ? { token: this.#token, userid: this.#userid } : {}) };
    let body = '';
    let aesKey = '';
    if (endpoint === 'qrKey') Object.assign(params, { appid: '1001', type: '1', plat: '4', qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&', srcappid: '2919' });
    else if (endpoint === 'qrPoll') Object.assign(params, { plat: '4', srcappid: '2919', qrcode: text(data.key, 'kugou.key') });
    else if (endpoint === 'account') {
      params.plat = '1'; body = JSON.stringify({ visit_time: time, usertype: 1, p: accountProof(this.#token, time), userid: this.#userid });
    } else if (endpoint === 'playlists') {
      params.plat = '1'; body = JSON.stringify({ userid: this.#userid, token: this.#token, total_ver: 979, type: 2, page: data.page, pagesize: 50 });
    } else if (endpoint === 'playlist') {
      body = JSON.stringify({ listid: data.id, userid: this.#userid, type: data.type, page: data.page, pagesize: kugouTrackPageSize, area_code: 1, allplatform: 1, show_cover: 1, token: this.#token });
    } else if (endpoint === 'searchSongs' || endpoint === 'searchPlaylists') {
      Object.assign(params, { keyword: data.query, page: data.page, pagesize: 30, platform: 'AndroidFilter', iscorrection: 1,
        ...(endpoint === 'searchSongs' ? { privilegefilter: 0, area_code: 1, dopicfull: 1 } : { albumhide: 0, nocollect: 0 }) });
    } else if (endpoint === 'publicPlaylists') {
      body = JSON.stringify({ appid: 1005, mid: this.#mid, clientver: 20489, platform: 'android', clienttime: time,
        userid: this.#userid || 0, module_id: 1, page: data.page, pagesize: 30,
        key: md5(`1005OIlwieks28dk2k092lksi2UIkp20489${time}`),
        special_recommend: { withtag: 1, withsong: 1, sort: 1, ugc: 1, is_selected: 0, withrecommend: 1, area_code: 1, categoryid: 0 },
        req_multi: 1, retrun_min: 5, return_special_falg: 1 });
    } else if (endpoint === 'publicPlaylist') {
      Object.assign(params, { area_code: 1, begin_idx: data.offset, plat: 1, type: 1, mode: 1, personal_switch: 1,
        extend_fields: 'abtags,hot_cmt,popularization', pagesize: data.limit, global_collection_id: data.id });
    } else if (endpoint === 'resource') {
      const hash = text(data.hash, 'kugou.hash').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hash)) throw new DomainError('invalid-input');
      body = JSON.stringify({ appid: 1005, area_code: 1, behavior: 'play', clientver: 20489,
        need_hash_offset: 1, relate: 1, support_verify: 1,
        resource: [{ type: 'audio', page_id: 0, hash, album_id: 0 }],
        qualities: ['128', '320', 'flac', 'high'],
      });
    } else if (endpoint === 'stream') {
      // 歌单/搜索数据里的 album_id/album_audio_id 可能与主 hash 错配，带上会被平台带到其他文件。
      // 固定 0，让平台只按 hash 解析；IsFreePart 默认 0，避免返回另一条试听音频。
      Object.assign(params, { album_id: 0, area_code: '1', hash: data.hash, ssa_flag: 'is_fromtrack', version: '11430', page_id: '151369488', quality: '128', album_audio_id: 0, behavior: 'play', pid: '2', cmd: '26', pidversion: '3001', IsFreePart: data.freePart === true ? '1' : '0', ppage_id: '463467626,350369493,788954147', cdnBackup: '1', module: '', clientver: '11430' });
      params.key = md5(`${params.hash}57ae12eb6890223e355ccfcb74edf70d1005${this.#mid}${this.#userid || '0'}`);
    } else if (endpoint === 'register') {
      aesKey = randomBytes(3).toString('hex'); const digest = md5(aesKey);
      const cipher = createCipheriv('aes-128-cbc', Buffer.from(digest.slice(0, 16)), Buffer.from(digest.slice(16)));
      // 只发送本次临时会话的随机标识，不采集设备硬件/传感器信息。
      const payload = JSON.stringify({ brand: 'StarsMusic', manufacturer: 'StarsMusic', device: 'Linux', buildSerial: 'unknown', uuid: this.#guid, imei: this.#guid, imsi: '' });
      body = Buffer.concat([cipher.update(payload), cipher.final()]).toString('base64');
      Object.assign(params, { part: '1', platid: '1', p: registerProof({ aes: aesKey, uid: this.#userid || 0, token: this.#token }) });
    }
    const web = endpoint === 'qrKey' || endpoint === 'qrPoll';
    params.signature = signature(params, body, web);
    const [target, router] = endpoints[endpoint];
    const combined = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    try {
      const response = await fetch(`${target}?${new URLSearchParams(params)}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: combined,
        headers: { 'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi', dfid: this.#dfid, mid: this.#mid, clienttime: String(time),
          'kg-rc': '1', 'kg-thash': '5d816a0', 'kg-rec': '1', 'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
          ...(router ? { 'x-router': router } : {}), ...(body ? { 'Content-Type': aesKey ? 'application/octet-stream' : 'application/json' } : {}) },
        ...(body ? { body } : {}),
      });
      if (response.headers.has('ssa-code')) { await response.body?.cancel(); throw new DomainError('verification-required'); }
      if (response.status === 429) throw new DomainError('rate-limited');
      if (!response.ok) throw new DomainError('network');
      const reader = response.body?.getReader(); if (!reader) throw new DomainError('invalid-response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
          if (size > 8 * 1024 * 1024) throw new DomainError('invalid-response'); chunks.push(value); }
      } finally { await reader.cancel(); }
      combined.throwIfAborted();
      let bytes = Buffer.concat(chunks);
      if (aesKey && bytes[0] !== 123) {
        const digest = md5(aesKey); const decipher = createDecipheriv('aes-128-cbc', Buffer.from(digest.slice(0, 16)), Buffer.from(digest.slice(16)));
        bytes = Buffer.concat([decipher.update(bytes), decipher.final()]);
      }
      const result = record(parseApiJson(bytes.toString('utf8')), 'kugou.response');
      if (epoch !== this.#epoch) throw new DomainError('cancelled');
      if (endpoint === 'register' && result.status === 1) {
        const dfid = text(record(result.data, 'kugou.device').dfid, 'kugou.dfid');
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(dfid)) throw new DomainError('invalid-response'); this.#dfid = dfid;
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof DomainError) throw error;
      if (signal.aborted) throw new DomainError('cancelled');
      if (combined.aborted) throw new DomainError('timeout');
      if (error instanceof SyntaxError) throw new DomainError('invalid-response');
      throw new DomainError('network');
    }
  }
}
