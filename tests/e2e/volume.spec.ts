/// <reference lib="dom" />
import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { playbackChannels, parsePlaybackSnapshot } from '../../packages/contracts/src/playback';

test('音量即时拖动、旧状态不抢滑块、请求合并、键盘和静音', async () => {
  const profile = await mkdtemp('/tmp/starsmusic-volume-e2e-'); const env: Record<string,string> = {};
  for (const [key,value] of Object.entries(process.env)) if (value !== undefined) env[key]=value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; env.GSETTINGS_BACKEND='memory';
  const app = await _electron.launch({args:['.',`--user-data-dir=${profile}`,'--password-store=basic'],env,chromiumSandbox:true});
  try {
    const page = await app.firstWindow(); await page.setViewportSize({width:1280,height:800});
    await expect(page.getByRole('heading',{name:'音乐库',exact:true})).toBeVisible();
    const fixture = parsePlaybackSnapshot({revision:100,generation:1,status:'idle',queue:[],currentIndex:null,positionSeconds:0,durationSeconds:0,volume:70});
    // 合成迟到音量响应，无音频、无平台账号。
    await app.evaluate(({ipcMain,BrowserWindow},{channels,fixture})=>{
      let state=fixture; const calls:number[]=[]; Reflect.set(globalThis,'__volumeCalls',calls);
      const publish=()=>{state={...state,revision:state.revision+1};BrowserWindow.getAllWindows()[0]!.webContents.send(channels.stateChanged,state);return state;};
      Reflect.set(globalThis,'__oldVolume',()=>{state={...state,volume:4};publish();});
      ipcMain.removeHandler(channels.setVolume); ipcMain.removeHandler(channels.setMuted);
      ipcMain.handle(channels.setVolume,async(_event,value:number)=>{calls.push(value);await new Promise(done=>setTimeout(done,90));state={...state,volume:value,muted:false};return publish();});
      ipcMain.handle(channels.setMuted,(_event,muted:boolean)=>{state={...state,muted};return publish();}); publish();
    },{channels:playbackChannels,fixture});
    const slider=page.getByRole('slider',{name:'音量',exact:true}); const bounds=(await slider.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height/2);await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.25,bounds.y+bounds.height/2,{steps:12});
    await page.mouse.move(bounds.x+bounds.width*.88,bounds.y+bounds.height/2,{steps:18});
    const value=await slider.inputValue();
    await app.evaluate(()=>{(Reflect.get(globalThis,'__oldVolume') as ()=>void)();});
    await expect(slider).toHaveValue(value); await page.mouse.up();
    await expect.poll(async()=>app.evaluate(()=>(Reflect.get(globalThis,'__volumeCalls') as number[]).at(-1))).toBe(Number(value));
    await expect(page.locator('.volume-control output')).toHaveText(value);
    expect(await app.evaluate(()=>(Reflect.get(globalThis,'__volumeCalls') as number[]).length)).toBeLessThan(15);
    await slider.focus();await slider.press('End');await expect(slider).toHaveValue('100');
    await slider.press('ArrowLeft');await expect(slider).toHaveValue('99');
    await expect.poll(async()=>app.evaluate(()=>(Reflect.get(globalThis,'__volumeCalls') as number[]).at(-1))).toBe(99);
    await page.getByRole('button',{name:'静音',exact:true}).click();
    await expect(page.getByRole('button',{name:'取消静音',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(slider).toHaveValue('99');
    await page.getByRole('button',{name:'取消静音',exact:true}).click();await expect(slider).toHaveValue('99');
  } finally {await app.close();await rm(profile,{recursive:true,force:true});}
});
