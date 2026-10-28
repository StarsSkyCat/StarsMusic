const { app, BrowserWindow } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

// 仅转换仓库自身的 SVG，不加载网络、业务 preload 或用户配置。
app.enableSandbox();
app.setPath('userData', path.join(process.argv[3], 'icon-profile'));
app.whenReady().then(async () => {
  const svg = await readFile(process.argv[2], 'utf8');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<html></html>');
  const entries = [];
  for (const size of [16, 32, 48, 256]) {
    const data = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))}; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size};
      canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size}); return canvas.toDataURL('image/png');
    })()`);
    entries.push({ size, png: Buffer.from(data.split(',')[1], 'base64') });
  }
  const header = Buffer.alloc(6 + 16 * entries.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, index) => {
    const at = 6 + index * 16; header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length;
  });
  await writeFile(path.join(process.argv[3], 'starsmusic.ico'), Buffer.concat([header, ...entries.map(entry => entry.png)]));
  await writeFile(path.join(process.argv[3], 'starsmusic.png'), entries.at(-1).png);
  window.destroy(); app.exit(0);
}).catch(() => { console.error('StarsMusic icon rendering failed'); app.exit(1); });
