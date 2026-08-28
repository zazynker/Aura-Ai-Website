# fal `compose` 真实能力探针

探针日期：2026-08-28  
端点：`fal-ai/ffmpeg-api/compose`

## 结论

`compose` 不能承担多视频轨合成，但可以承担“单视觉轨 + 多条显式音频轨”的最终混音。

| 能力 | 实测结果 | 证据 |
|---|---|---|
| 一条视频轨内顺序拼接 | 通过 | 两段 4 秒视频得到 8.03 秒成片 |
| 一条独立音频轨 | 部分通过 | 隐式的视频原声会被丢弃，只保留显式音频轨 |
| 多条显式音频轨 | 通过 | 把成片本身再作为 audio track 后，可以与额外音频混合 |
| 两条视频轨 | 不支持 | HTTP 400：`Multiple video tracks are not supported` |
| 两条视频轨重叠 | 不支持 | 同上；相同分辨率仍然失败 |
| `duration` 裁剪源视频 | 不支持 | 4 秒源写 `duration: 2000`，输出仍为 4.03 秒 |
| 不同画幅顺序拼接 | 能输出但不可直接采用 | 输出分辨率跟随第一段；项目仍需先统一画幅 |

因此，不能按“`tracks[]` 就等于任意多轨编辑器”的字面理解设计产品；但可以先把画面顺序合成，再用它完成最终音频混合。

## 测试素材

- 视频 A：320×240，红色，4 秒，440 Hz 原声
- 视频 B：240×320，蓝色，4 秒，660 Hz 原声
- 配音 C：6 秒，880 Hz

使用不同纯音是为了客观分析输出频谱，不依赖主观听感。

## 探针 1：顺序视频 + 独立音频

请求：

```json
{
  "tracks": [
    {
      "id": "video-main",
      "type": "video",
      "keyframes": [
        { "timestamp": 0, "duration": 4000, "url": "<video-a>" },
        { "timestamp": 4000, "duration": 4000, "url": "<video-b>" }
      ]
    },
    {
      "id": "voice",
      "type": "audio",
      "keyframes": [
        { "timestamp": 0, "duration": 6000, "url": "<voice-c>" }
      ]
    }
  ]
}
```

响应：

```json
{
  "request_id": "01a044fe-62f8-7d83-8c0d-7f0913bf7e93",
  "video_url": "https://v3b.fal.media/files/b/0aa81058/5QTAMDaaMlDyBJoRRkfwQ_output.mp4",
  "thumbnail_url": "https://v3b.fal.media/files/b/0aa81058/MHNxNRJrIpjW__dSoBDKi_first_frame.jpg"
}
```

输出为 8.03 秒、320×240。提取出的音轨只有 6.016 秒，三个采样区间的主频都只有 880 Hz；440 Hz 与 660 Hz 均不存在。这证明只声明额外音频轨时，视频原声不会被隐式保留。

## 探针 2：多视频轨

先用不同分辨率测试，再用相同 320×240 分辨率复测；重叠与不重叠也分别测试。四种组合都不能提交。

```json
{
  "status": 400,
  "detail": "Multiple video tracks are not supported"
}
```

失败请求 ID：

- `01a044ff-4273-7012-a790-b7337ac74d48`（相同分辨率、时间重叠）
- `01a044ff-4eb4-7783-a886-37df0311f7ef`（相同分辨率、不重叠）

这排除了“只是画幅不一致”或“只是时间重叠”的可能性。

## 探针 3：`duration` 是否裁剪

请求把 4 秒视频的 keyframe `duration` 设为 2000 毫秒。请求成功，但输出仍为 4.03 秒：

```json
{
  "request_id": "01a044fe-8294-7ae0-9a08-4d308c594c4d",
  "video_url": "https://v3b.fal.media/files/b/0aa81058/X4CN6Ez6oC5oe61tcKVxU_output.mp4"
}
```

裁剪必须使用单独的 `fal-ai/workflow-utilities/trim-video`，或在上传前烘焙完成；不能依靠 `compose` 的 keyframe `duration`。

## 探针 4：显式恢复视频原声并叠加额外音频

把同一条有声视频声明两次：一次作为唯一的 video track，一次作为 original-audio track；再加入额外音频轨。

```json
{
  "tracks": [
    {
      "id": "video-main",
      "type": "video",
      "keyframes": [
        { "timestamp": 0, "duration": 4000, "url": "<video-with-440hz-audio>" }
      ]
    },
    {
      "id": "original-audio",
      "type": "audio",
      "keyframes": [
        { "timestamp": 0, "duration": 4000, "url": "<same-video-with-440hz-audio>" }
      ]
    },
    {
      "id": "extra-audio",
      "type": "audio",
      "keyframes": [
        { "timestamp": 0, "duration": 4000, "url": "<880hz-audio>" }
      ]
    }
  ]
}
```

响应成功：

```json
{
  "request_id": "01a0450d-3590-7363-a344-b6f4aaa6a225",
  "video_url": "https://v3b.fal.media/files/b/0aa810b9/Gzv0utJZubaMxTB_LYnJy_output.mp4"
}
```

输出为 4.053 秒。频谱最高的两个峰分别为 880 Hz 和 440 Hz，证明视频原声与额外音频确实同时存在。可采用两阶段装配：先顺序合成带原声视频，再用 `compose` 把成片原声与额外音频混合。

## 官方资料

- https://fal.ai/models/fal-ai/ffmpeg-api/compose/api
- https://fal.ai/models/fal-ai/workflow-utilities/trim-video/api
- https://fal.ai/models/fal-ai/workflow-utilities/blend-video/api
- https://fal.ai/models/fal-ai/ffmpeg-api/merge-audio-video/api

官方 schema 没有声明“只支持一条视频轨”和“独立音轨替换原声”这两个关键限制，所以后续供应商能力必须以真实探针为准。
