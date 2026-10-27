import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopEnvironment } from '../../packages/desktop/src/platform.ts';
import { sessionAddress } from '../../packages/desktop/src/linux/bus.ts';

test('桌面环境只报告声明值，Wayland display 或桌面名称本身不等于能力可用', () => {
  assert.deepEqual(desktopEnvironment({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'niri' }), { session: 'wayland', desktop: 'niri' });
  assert.equal(desktopEnvironment({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }).session, 'unknown');
  assert.equal(desktopEnvironment({ XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'KDE' }).session, 'x11');
  assert.equal(desktopEnvironment({ XDG_CURRENT_DESKTOP: '<unsafe>' }).desktop, 'unsafe');
});
test('D-Bus 仅接受本地 Unix 地址，禁用命令执行、TCP 和畸形路径，无 native addon', () => {
  assert.equal(sessionAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus,guid=test' }, 1000), 'unix:socket=/run/user/1000/bus');
  assert.equal(sessionAddress({}, 1000), 'unix:socket=/run/user/1000/bus');
  assert.equal(sessionAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=synthetic' }, 1000), 'unix:socket=\0synthetic');
  for (const address of ['unixexec:path=/bin/sh', 'tcp:host=example.invalid,port=123', 'unix:path=relative', 'unix:path=/tmp/%00bad', 'unix:path=/tmp/%3bexec']) assert.throws(() => sessionAddress({ DBUS_SESSION_BUS_ADDRESS: address }, 1000));
});
