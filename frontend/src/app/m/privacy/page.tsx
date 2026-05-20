"use client";

/**
 * v27.0-mobile P20 · /m/privacy · 隐私保护指引 全文页.
 *
 * 用途:
 *   - 微信 mp 后台 "服务内容声明 → 隐私保护指引" 提交时, 引用的"完整链接"
 *   - H5 端 PrivacyConsent 弹窗 里 "查看完整版" 链接 跳过来
 *   - 2023.9 起 微信 强制 要求 小程序 在 收集 任一 个人信息前 必须 有 这份 完整 政策 文本
 *
 * 修改 这页 时 同步 改 mp 后台 提交的 文本 — 微信审核员 会 对比.
 */

import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link
          href="/m"
          className="-ml-2 flex h-10 w-10 items-center justify-center text-zinc-300 active:text-zinc-50"
          aria-label="返回"
        >
          <span className="text-2xl leading-none">←</span>
        </Link>
        <h1 className="flex-1 truncate text-[18px] font-semibold text-zinc-50">
          隐私保护指引
        </h1>
      </div>

      <main className="space-y-5 p-5 pb-12 text-[15px] leading-relaxed text-zinc-200">
        <p className="text-zinc-400">
          最近更新:{" "}
          <span className="text-zinc-300">2026 年 5 月</span> · 生效版本: v1.0
        </p>

        <Section title="一、引言">
          <p>
            欢迎使用 <strong>智囊团</strong>(由 Aimeeting 团队 出品,
            以下称"本产品" 或"本服务"). 本指引用于说明 我们在 你 使用本产品 过程中
            收集 / 使用 / 存储 / 共享 / 保护 你个人信息 的方式. 请你 仔细阅读
            并 知悉.
          </p>
          <p>
            <strong>使用本产品 视为 你 同意 本指引.</strong>{" "}
            若你 不同意 任一条款, 请 不要 使用 本产品.
          </p>
        </Section>

        <Section title="二、我们收集的个人信息">
          <p>为提供 协作会议 工作台 服务, 我们需要收集 以下信息:</p>
          <ol className="ml-4 list-decimal space-y-2">
            <li>
              <strong>账号身份信息</strong>:邮箱 / 姓名 / 所在工作区 +
              部门 / 角色. 用于 创建账号 + 在 会议中 标识 你身份.
            </li>
            <li>
              <strong>麦克风音频</strong>:在 你 主动开启 会议录音 后,
              通过 浏览器 / 微信 麦克风 API 采集 现场 音频, 实时
              转写为 文字. 仅在 会议进行中 采集, 退出 / 闭麦 立即 停止.
            </li>
            <li>
              <strong>声纹特征值</strong>:首次 录入 时 采集 30 秒 音频
              提取声纹模板 (不存储 原始音频), 用于 在 会议中 识别 "谁在说话".
              可在 个人设置 中 删除.
            </li>
            <li>
              <strong>会议内容</strong>:你 创建 / 参加 的 会议 标题 / 议程 /
              brief 描述 / 上传的 文档 (PDF / Word / Excel / PPT / 图片 / 文本) /
              实时 转录文本 / AI 生成 的 纪要 + 待办.
            </li>
            <li>
              <strong>任务 / 行动 信息</strong>:从 会议中 抽出的 待办 + 你
              填写的 评论 + 进度 状态.
            </li>
            <li>
              <strong>设备 / 网络 信息</strong>:浏览器型号 / 操作系统 / IP
              地址 / 网络类型. 用于 错误诊断 + 服务质量 优化, 不与 身份
              直接关联.
            </li>
            <li>
              <strong>操作日志</strong>:登录时间 / 创建/编辑 关键资源 的
              时间戳 + 操作人. 用于 安全审计 + 客户支持. 保留 180 天 后
              自动清除.
            </li>
          </ol>
        </Section>

        <Section title="三、如何使用收集的信息">
          <ul className="ml-4 list-disc space-y-2">
            <li>
              提供 核心服务:实时转录 / AI 摘要 / 任务派发 / 知识沉淀 等.
            </li>
            <li>
              安全 + 反作弊:识别 异常登录 / 防止 账号被 盗用.
            </li>
            <li>
              产品 优化:基于 匿名化 的 聚合统计 (例如 全平台 总会议数 /
              平均 时长) 改进 功能, 不针对 个人.
            </li>
            <li>
              <strong>
                我们 不会 把 你的 个人信息 用于 广告推送 / 出售 / 跨产品
                追踪.
              </strong>
            </li>
          </ul>
        </Section>

        <Section title="四、信息共享 与 第三方 SDK">
          <p>
            为 实现 本产品 功能, 我们 会 把 必要 的 信息 提供 给 以下
            第三方 服务, 严格 限于 完成 服务 所必需 的 范围:
          </p>
          <Table
            cols={["第三方", "用途", "传输内容", "是否含个人身份"]}
            rows={[
              [
                "阿里云 DashScope (通义千问)",
                "LLM 推理 (议程拆解 / 纪要 / 待办抽取)",
                "会议 brief / 转录段落 / 议程 / 文档摘要",
                "默认不含;若你 在 brief 里 写了 自己 姓名 则含",
              ],
              [
                "阿里云 DashScope (Qwen-VL)",
                "图片 OCR — 抽取 上传图片 中的 文字",
                "你上传的 图片 二进制",
                "图片 内容 决定",
              ],
              [
                "阿里云 OSS (对象存储)",
                "存储 会议 录音 / 上传 附件 + 抽取后 的 文本",
                "音频 / 文档 / 图片",
                "同上",
              ],
              [
                "pyannoteAI",
                "说话人 识别 (声纹比对)",
                "30 秒 声纹采样 + 会议音频片段",
                "不含 姓名 / 邮箱;仅 声纹 特征值",
              ],
              [
                "FunASR (本地 / 私有部署)",
                "语音 → 文字 (ASR)",
                "麦克风 音频流",
                "音频内容 决定",
              ],
              [
                "微信 SDK (小程序场景)",
                "授权登录 / 文件选择 (聊天记录) / 分享",
                "微信 openid (你 主动 授权 后)",
                "openid 仅 微信内 标识, 不暴露 给 其他 用户",
              ],
            ]}
          />
          <p className="text-[13px] text-zinc-400">
            上述 第三方 均 与 我方 签署 数据 处理 协议, 仅在 完成 服务 范围内
            处理 信息, 不得 用于 其他 目的.
          </p>
        </Section>

        <Section title="五、信息存储 与 安全">
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <strong>存储 地点</strong>:中国境内 (阿里云 杭州 / 北京 节点),
              不跨境 传输 个人信息.
            </li>
            <li>
              <strong>存储 时长</strong>:会议 内容 + 声纹 + 任务 长期 保存
              (你可 随时 在 应用 内 删除);操作日志 180 天;
              错误日志 90 天.
            </li>
            <li>
              <strong>传输 安全</strong>:全站 强制 HTTPS / WSS, 通信 加密.
            </li>
            <li>
              <strong>存储 安全</strong>:数据库 + OSS 启用 静态加密;
              管理员 访问 走 内部 ABAC + 二次确认.
            </li>
          </ul>
        </Section>

        <Section title="六、你的权利">
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <strong>查阅</strong>:你 可在 "我的 / 会议 / 任务" 等 页面
              查阅 自己 的 所有 数据.
            </li>
            <li>
              <strong>修改</strong>:你 可 编辑 个人 资料 / 会议 / 任务 / 评论.
            </li>
            <li>
              <strong>删除</strong>:你 可 删除 自己 创建 的 会议 / 附件 /
              声纹. 删除 后 立即 从 业务库 移除, 备份 在 30 天 内 清除.
            </li>
            <li>
              <strong>导出</strong>:会议 纪要 + 转录 可 在 详情 页 导出
              Markdown / Word.
            </li>
            <li>
              <strong>撤回 授权</strong>:你 可 在 "我的 / 设置" 内 关闭
              麦克风 / 声纹 等 单项 授权.
            </li>
            <li>
              <strong>注销</strong>:可 联系 工作区 owner 发起 账号 注销.
              注销 后 个人数据 彻底 删除, 不可恢复.
            </li>
          </ul>
        </Section>

        <Section title="七、未成年人保护">
          <p>
            本产品 面向 <strong>16 岁以上</strong> 企业 / 政府 / 团队
            用户 提供 服务. 我们 不会 主动 收集 16 岁 以下 未成年人 的
            个人信息. 若 你是 监护人, 且 发现 未成年人 误注册, 请
            联系 工作区 管理员 协助 注销.
          </p>
        </Section>

        <Section title="八、政策 变更">
          <p>
            我们 可能 不时 更新 本指引. 重大 变更 (例如 收集项 / 共享对象
            发生 实质 增加) 时, 会在 应用 内 通过 弹窗 显著 提示, 并
            重新 征求 你的 同意.
          </p>
        </Section>

        <Section title="九、联系我们">
          <p>
            如对 本指引 有 任何 疑问 / 投诉 / 维权 请求, 请 联系
            工作区 owner / admin (在 "我的 / 设置" 内 可 查看 联系方式),
            或 发送 邮件 至{" "}
            <a
              href="mailto:bluesurfiregpt@gmail.com"
              className="text-violet-300 underline underline-offset-2"
            >
              bluesurfiregpt@gmail.com
            </a>{" "}
            (产品负责人), 我们 将在 15 个 工作日内 回复.
          </p>
        </Section>

        <div className="mt-8 rounded-2xl border border-zinc-800 bg-ink-900 p-4 text-[13px] text-zinc-400">
          本指引 解释权 归 智囊团 (Aimeeting) 团队 所有. 若 中文 与 任何 其他 语种
          版本 存在 歧义, 以 中文 版本 为准.
        </div>
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-[16px] font-semibold text-zinc-50">{title}</h2>
      <div className="space-y-2 text-[14px] leading-relaxed text-zinc-300">
        {children}
      </div>
    </section>
  );
}

function Table({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full min-w-[480px] text-[12px]">
        <thead>
          <tr className="bg-ink-900 text-left text-zinc-400">
            {cols.map((c, i) => (
              <th
                key={i}
                className="border-b border-zinc-800 px-2 py-2 font-medium"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="text-zinc-300">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border-b border-zinc-800/60 px-2 py-2 align-top last:border-b-0"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
