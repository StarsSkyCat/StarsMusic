# 第三方来源与许可

## 网易云协议格式

packages/providers/src/netease/crypto.ts 的 eapi/weapi 格式和公开协议常量参考 NeteaseCloudMusicApiEnhanced/api-enhanced 4.41.1，以 Node.js crypto 重新实现；所需端点字段同样以该版本为基线。没有复制参考播放器代码或视觉资产，也没有加载该 SDK 的服务器、日志、共享令牌文件或音源解锁模块。

- 来源：[api-enhanced 4.41.1](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/tree/2db6684453297ee86dec0492842f2320b08182d9)
- 对应文件：util/crypto.js、util/config.json、module/login_qr_key.js、login_qr_check.js、user_account.js、user_playlist.js、playlist_detail.js、song_detail.js、song_url.js。
- 提交：2db6684453297ee86dec0492842f2320b08182d9。
- 原许可：[MIT](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/2db6684453297ee86dec0492842f2320b08182d9/LICENSE)。完整声明如下；项目整体许可仍未确定。

```text
The MIT License (MIT)

Copyright (c) 2013-2022 Binaryify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 酷狗协议格式

packages/providers/src/kugou/crypto.ts 与 transport.ts 的扫码、设备注册、签名和端点字段参考 MakcRe/KuGouMusicApi 1.6.2，以 Node.js crypto/fetch 重新实现；所需端点白名单固定在该 transport。没有复制参考播放器代码或视觉资产，也没有加载该 SDK 的 Express 服务、共享设备配置或任意接口模块。

- 来源：[KuGouMusicApi 1.6.2](https://github.com/MakcRe/KuGouMusicApi/tree/62730f900dc9fdc51396a663b3d33a6c4c704046)
- 对应文件：util/config.json、util/crypto.js、util/helper.js、util/request.js、util/util.js、module/login_qr_key.js、login_qr_check.js、register_dev.js、user_detail.js、user_playlist.js、playlist_track_all_new.js、song_url.js、privilege_lite.js。
- 提交：62730f900dc9fdc51396a663b3d33a6c4c704046。
- 原许可：[MIT](https://github.com/MakcRe/KuGouMusicApi/blob/62730f900dc9fdc51396a663b3d33a6c4c704046/LICENSE)。完整声明如下；项目整体许可仍未确定。

```text
MIT License

Copyright (c) 2023 MakcRe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

直接 npm 依赖及系统运行时记录见 [依赖说明](docs/dependencies.md)。此文件不替代正式发行时对 Electron、Chromium、mpv、FFmpeg 及完整依赖树的许可清单。

## 界面图标和背景

@lucide/vue 1.61.0 通过 npm 官方注册表引入，用于导航和播放控件。Lucide Icons and Contributors 的 ISC 声明以及 Feather / Cole Bemis 的 MIT 声明均保存在 [完整许可](docs/licenses/lucide.txt)。未复制其他播放器的图标和视觉资产。

星夜山景由内置 Image Gen 于 2026-10-26 为本项目生成，作为品牌默认配图；不是平台专辑封面。来源与使用位置见 [素材说明](src/renderer/src/assets/README.md)。
