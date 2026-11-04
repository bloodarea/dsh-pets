/**
 * DSH Pets 的 Host 占位入口。
 *
 * 本项目负责消费完整人物包，桌宠窗口、会话跟踪、通知、动画与语音播放仍在规划中。
 * 人物制作脚本与技能属于独立的 dsh-pets-character-studio，不在此注册或加载。
 * 当前入口仅保留 Cordis bundle 的安装与激活形态，不声明已实现的桌宠能力。
 */

/** Loader 行 id / 包名，与 cordis.patch.yml 保持一致。 */
export const name = 'dsh-pets'

/** 占位入口；当前无服务依赖，也不注册工具、技能或桌宠功能。 */
export function apply() {}
