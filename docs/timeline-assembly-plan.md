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

### 2026-08-29：时间线来源选择 UX 修正

早期界面的 `Video clip` 每次都会默认选择第一个视频步骤；当多个步骤都叫 `Image to Video` 时，下拉菜单也不显示步骤编号。这会让正常的三步装配看起来像把同一个素材重复五次。

修正后的规则：

- `Next unused step (N)` 按工作流顺序加入下一个尚未使用的视频或音频步骤，全部加入后按钮禁用。
- 步骤选项显示 `Step N · capability · behavior`，例如 `Step 4 · Image to Video · user-editable input`。
- 同一步骤仍允许有意使用多次，但重复时显示黄色提示，不再把重复作为默认行为。
- 原来的 `Fixed template video/audio` 改名为 `Standalone uploaded video/audio · not a workflow step`，并用独立按钮添加。
- 一个步骤是复用模板结果还是根据用户输入重新生成，由该步骤的 Quick Use 配置和运行时复用规则决定；timeline 只决定步骤结果出现的顺序和次数。
- 视频和音频分别显示 `当前数量/8`，达到上限后不再允许继续添加。

因此，一个包含 Step 3、4、5 三个 `Image to Video` 的模板，正常配置是把这三个步骤结果各放一次。即使 Step 3 使用固定 First Frame、Step 4 允许用户替换 First Frame，它们在 timeline 中仍然都是步骤结果；只有不属于任何步骤的片头、片尾或外部素材才使用 Standalone upload。

### 2026-08-29：复用音频未进入成片与配置职责收敛

用户实测中 Audio 1、2 都显示为 `reused from the template`，但最终 9 秒视频没有这两条音频。根因不是复用音频 URL 丢失：那次已发布定义仍启用了旧 `finalVideo` / `Merge selected shots`。旧装配器只读取视频步骤 ID，设计上完全不读取音频步骤；步骤结果卡片显示“复用成功”只证明音频步骤执行完成，不代表旧 Merge 会消费它。

修正后的单一职责：

- Admin Builder 的 `Final timeline · video + multi-track audio` 是新模板唯一的最终装配配置。
- Quick Use Builder 不再提供可修改的 `Merge selected shots`，只显示上一步锁定的装配摘要，避免 Timeline 和 Merge 两套配置互相覆盖。
- 老模板的 `finalVideo` 仍由服务端兼容；Admin 启用 Final assembly 时，如果 Timeline 还没有视频行，会把旧 Merge 选中的视频步骤迁移为 Timeline 视频行，并关闭旧 Merge。
- Timeline 启用后，视频先顺序合成，再把该视频作为显式原声音轨，与所有 Timeline Audio rows 一起提交给 `compose`；因此复用音频和新生成音频走同一条混音路径。
- 若草稿仍处于旧 Merge，Admin Builder 会明确警告“video-only，不能包含 Audio steps”。
- 草稿可以继续保存；但只要已经配置 Audio rows 却未启用 Timeline，Quick Use 的提交审核会被阻止，避免再次发布出“音频步骤完成但最终成片未消费”的版本。

Quick Use 可编辑参数也改为 Admin allow-list：

- `QuickUseDefinition.editableSettings` 保存 Admin 勾选的具体 `stepId + parameterKey`。
- Voice ID、Speed、Volume、Pitch、Emotion、Language、Format、Duration、Resolution、Generate audio 等都在各自步骤的 Admin Builder 面板逐项勾选。
- 未勾选的参数保留 Workflow 默认值，不出现在下一页候选库；取消勾选会同步移除已放入 Quick Use 画布的对应控件。
- 新模板默认一个设置都不开放。旧草稿迁移时只保留已经放在 Quick Use 画布上的 Setting，避免过去“Registry 所有可编辑参数全部塞进候选库”的行为。
- Quick Use 候选项显示 `Step N`，同名 Text to Speech / Image to Video 步骤仍可区分。

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

## 2026-09-05：多 Result 持久化与 Quick Use 选择职责修正

本轮针对管理员实测的三个问题完成修正：

- **重新 Edit 后 Result 为空**：文件没有丢失。保存使用的是 `${step.id}-result-${option.id}`，旧读取代码却只按 `step-N-result-*` 查找，新增步骤的真实 ID 并不等于序号。读取端现在优先使用稳定步骤 ID，并兼容旧序号 key；Result 名称和类型也随 workflow 版本保存，重新打开不再退回空白或通用名称。
- **Final Assembly 不再选择具体 Result**：这里的一行只选择“哪个 workflow step 占据这个视频/音频位置”。多 Result 步骤显示有多少个 Quick Use choices，但不会在 Admin timeline 里预先锁定 Result 1/2。
- **Result Choices 变成普通 Quick Use 积木**：只有被最终装配使用且拥有多个 Result 的步骤会在左侧 `Result choices` 分类出现。管理员可把它拖到中间画布、调整顺序、修改标题、选项名称和默认 Result；未拖入画布就不会出现在用户页面。
- **前台样式统一**：新版本通过普通 Quick Use block 渲染 Result choice，使用与其他非 Primary 输入相同的白色折叠卡片。已发布旧版本继续显示兼容选择器，但也去掉了特殊蓝色底板。
- **选择不触发付费生成**：切换 Result choice 只改变最终装配所取的已上传资产，不会把该步骤判定为“用户修改”，也不会调用图片、视频或音频供应商。
- **复用路径补齐**：模板步骤结果加载支持稳定的多 Result asset key；没有用户修改时仍能免费复用默认 Result，最终装配再按用户的 choice 选择对应资产。

验证状态：

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `git diff --check`
- [ ] 部署后管理员验收：Edit 已发布模板，确认多个 Result 均恢复；进入 Quick Use Builder，把 Result choice 从左侧拖入并排序；发布后分别选择两个 Result，确认最终视频使用对应素材且不触发该步骤供应商生成。

## 2026-09-05：计费显示与装配探针修正

- Result choice 不再被当作生成步骤的 Required 输入。无论用户选择 Result 1 还是 Result 2，都只是在已保存资产之间切换，不计入该步骤的 credits，也不会触发供应商。
- 新的候选项默认不强制 Required；是否必填由 Quick Use Builder 中管理员勾选的 `Required` 决定。没有用户上传、没有改参数的步骤会走模板 Result 复用；只有明确必填或实际改动才进入计费估算。
- Final Assembly 原先用 Fal `ffmpeg-api/metadata` 探测每个片段的尺寸和时长。两段视频一次合成因此可能出现 3 条约 `$0.0002` 的 metadata 记录，虽然没有生成镜头。现在改用服务器自带 ffmpeg 在本地读取媒体信息，纯拼接不再调用 Fal metadata；有额外音频时只提交一次 compose 混音任务。
- 多 Result 恢复读取增加了旧资产 key 的后缀兼容，能识别旧版按序号、按步骤 ID 或历史前缀保存的结果，避免再次打开时把已保存 Result 判定为丢失。
