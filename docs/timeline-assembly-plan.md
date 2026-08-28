# Timeline 装配实施记录

更新日期：2026-08-28  
依据：代码审查、CapCut 截图、MiniMax 官方 API schema 和 [`compose` 真实探针](./compose-probe.md)

## 当前交接点

- [x] M1：实测 `fal-ai/ffmpeg-api/compose`。
- [x] M2：审计 Builder、Quick Use、模板资产、生成记录与装配状态机。
- [x] M3：新增 `audio.text_to_speech` 和 MiniMax Speech 2.5 HD 纯音频生成。
- [x] M4：新增 timeline 类型、校验、固定素材保存与加载。
- [x] M5：实现 `padding → merging → mixing → storing`，兼容旧 v1 检查点。
- [x] M6：在 Admin Template Builder 加入视频序列和多音轨选择面板。
- [x] M7：完成最终构建、差异审查和可执行范围内的回归验证。
- [x] 应用数据库迁移。
- [x] 提交并通过 GitHub Desktop 推送。

当前执行点：**实现、迁移、验证和推送均已完成；等待管理员账户做真实模板验收。**

## 已确认的供应商能力

`compose` 不是通用多视频轨编辑器：两条 video track 会返回 `Multiple video tracks are not supported`，而 keyframe 的 `duration` 也不能作为裁剪手段。

它可以完成当前需求的音频叠加：

1. 先用现有 padding/merge 流程得到一条顺序视频；
2. 在 `compose` 中把顺序视频作为唯一 video track；
3. 再把同一视频作为显式 audio track，恢复片段原声；
4. 把每条固定音频或音频步骤结果作为额外 audio track，并设置开始时间。

探针输出同时检测到 440 Hz 视频原声和 880 Hz 叠加音，所以“视频已有音频 + 额外多轨音频”可以实现。完整请求和结果见 `docs/compose-probe.md`。

## 实际数据结构

时间线保存在已锁定模板版本的 `quick_use_definition` 中：

```ts
type QuickUseTimelineClipSource =
  | { kind: 'template_asset'; assetKey: string }
  | { kind: 'step_result'; stepId: string };

interface QuickUseTimelineDefinition {
  enabled: boolean;
  preserveVideoAudio: true;
  videoClips: Array<{
    id: string;
    source: QuickUseTimelineClipSource;
  }>;
  audioClips: Array<{
    id: string;
    source: QuickUseTimelineClipSource;
    startMs: number;
  }>;
}
```

视频数组顺序就是最终播放顺序。每行可以在固定模板素材和某个同类型步骤结果之间切换，切换不会改变位置。额外音频允许固定文件或 `audio.text_to_speech` 的步骤结果。

固定素材继续使用现有 `template_assets` 表和存储桶，因此 timeline 本身不需要新表；纯音频生成结果需要新字段，见 `supabase/migrations/202608280000_audio_generation.sql`。

## MiniMax 纯音频节点

新增能力：`audio.text_to_speech`  
供应商端点：`fal-ai/minimax/preview/speech-2.5-hd`

Builder 可配置：文案、Voice ID、速度、音量、音高、情绪、语言增强和 MP3/FLAC。Quick Use 执行时由服务端鉴权、限流、检查并扣除积分；生成结果以 `media_type = audio`、`audio_url`、`audio_duration_seconds` 保存，也可以像图片/视频步骤一样复用。

为了兼容旧历史查询，音频 URL 同时镜像到旧的 `image_url` 必填字段；新的展示和装配逻辑优先读取 `audio_url`。

## 装配状态兼容

- 老模板没有 timeline，仍使用原 `finalVideo` 顺序拼接与 v1 checkpoint。
- timeline 运行使用 v2 checkpoint，并保存稳定的输入指纹。
- v1 reader 被保留；升级不会清空旧的 padding/merge job，也不会让正在运行的订单重复付费。
- v2 只有在片段数量、来源或音频开始时间变化时才拒绝恢复旧状态。
- 最终文件存在时直接返回缓存结果，重复 finalize 不会重复提交供应商任务。

## Admin Template Builder

Admin 模式新增 `Final timeline · video + multi-track audio`：

- 视频序列：添加、删除、上下移动；选择固定视频或视频步骤结果。
- 音频叠加：添加、删除；选择固定音频或 Text to Speech 步骤结果；填写开始秒数。
- 开启 timeline 时自动关闭旧 `finalVideo`，两种装配模式不会同时运行。
- 固定文件保存后会获得稳定 asset key；重新打开草稿仍可预览并替换。
- 类型校验会阻止视频行选择音频步骤，或音频行选择视频步骤。

## 第一版有意保留的边界

- 不支持画中画、透明叠加、分屏或两段视频同时可见。
- 不在服务端裁剪或变速；固定片段需先导出成最终时长和速度。
- 不提供音量自动压低、淡入淡出或 ducking；上传前先处理响度。
- 音频开始时间可编辑，但暂不提供拖拽式时间轴。
- `compose` 的 duration 不能可靠裁剪过长音频，因此附加音频应先裁到所需长度。

## 上线顺序

1. `supabase/migrations/202608280000_audio_generation.sql` 已于 2026-08-28 应用到项目当前链接的远端数据库。
2. 部署前端与 API；数据库现在已具备音频字段。
3. 在 Admin Builder 创建一条 Text to Speech 步骤，生成并保存示例音频。
4. 在 Final timeline 中加入视频序列和音频叠加，设置开始时间并发布新模板版本。
5. 用真实用户账户完整执行一次，核对视频原声、叠加音频、积分和重复 finalize。

## M7 验证记录

- TypeScript：`npx tsc --noEmit` 通过。
- 生产构建：`npm run build` 通过；仅有项目原有的 chunk 拆分提示和 Browserslist 数据过期提示。
- 补丁格式：`git diff --check` 通过。
- 非登录 Builder：已在本地浏览器确认 Text to Speech 入口、参数面板和无素材状态。
- Admin timeline：当前本地会话未登录，无法在不绕过权限的情况下打开；由类型/构建检查覆盖，部署后需用管理员账户做一次交互验收。
- 真实付费 TTS：未调用，避免在数据库迁移和登录环境未就绪时产生无法落库的付费结果。
