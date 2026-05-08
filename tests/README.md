# Aimeeting · 自动化回归套件

## 文件清单

| 文件 | 用途 |
|---|---|
| `cowork_suite.js` | **测试套件本体**。Self-contained JS,挂在 `window.runCoworkSuite()`。Cowork 在浏览器 console 加载 + 执行。 |
| `baseline.json` | **T2 baseline** 快照(每用例 `{id, series, status}`)。下次跑只需 diff 出新失败 / 新通过。 |

## 运行(任何 Cowork / 人工操作员)

部署后,套件文件已经被前端 build pipeline 当作静态资产打包,可以从 https://aimeeting.zhzjpt.cn/cowork_suite.js 直接 fetch 到。

### 一键跑(在已登录的浏览器 console):

```js
const src = await fetch('/cowork_suite.js?v=' + Date.now()).then(r => r.text());
new Function(src)();
const r = await runCoworkSuite();
console.log(r.markdown);   // 给人看的报告
console.log(JSON.stringify(r.json, null, 2));  // 机器可读, 用于 diff baseline
```

### 跑完后

- `r.json.results[]` 形如 `{id, series, status, ms, evidence?, error?}`
- `r.markdown` 是分节表格 markdown,可直接贴 issue / Slack
- 全程自动清理:每用例创建的资源都标了 `_cowork_suite_<runid>` 前缀,跑完 DELETE

## T2 baseline diff(已内建 · v15+)

套件**自动** fetch `/baseline.json` 并做 diff,5 个分类桶:

- 🔴 **regressions** — baseline pass / now fail|skipped (or baseline skipped / now fail)
- 💚 **fixed** — baseline fail / now pass
- ✨ **new_passes** — baseline skipped / now pass
- 🆕 **new_cases** — not in baseline
- ⚠️ **missing** — in baseline but not in this run

CI gate 看 `r.json.summary.passed_baseline`(true 当且仅当 `regressions === 0 && missing === 0`)。

显式禁用 diff(纯运行,不比对):
```js
const r = await runCoworkSuite({ baseline: false });
```

显式给一个不同的 baseline:
```js
const r = await runCoworkSuite({ baseline: myBaselineObj });
```

## 更新 baseline

当出现合法的 fixed / new_passes / new_cases 时:

```js
// 在跑完一次后:
const fresh = {
  schema_version: 1,
  frozen_at: new Date().toISOString(),
  frozen_against: 'v15 (commit XXXXXX)',
  cases: r.json.results
    .map(x => ({id: x.id, series: x.series, status: x.status}))
    .sort((a,b) => a.id.localeCompare(b.id)),
};
copy(JSON.stringify(fresh, null, 2));
// 粘贴到:
//   tests/baseline.json
//   frontend/public/baseline.json   ← 注意要同步,前端那份是套件 fetch 的
```

不要忘了同步两份。下个迭代(T3 GitHub Actions)会自动校验两份一致。

## 增加用例

在 `cowork_suite.js` 的 `registerCases(R)` 里 push:

```js
R.register({
  id: "Q-99",
  series: "Q",
  title: "短描述",
  async run(ctx, cleanup) {
    // ... do stuff
    return { ok: true, evidence: { _note: "短结论" } };
    // OR
    return { ok: false, error: "what went wrong", evidence: {...} };
    // OR for cascade-skip:
    return { ok: false, error: "SKIP_DEP_FAILED:Q-1" };
  },
});
```

`ctx` 跨用例共享(比如 G-1 创了个 meeting 给 G-3 / R-1 / R-2 复用)。
`cleanup.push({kind, id, label})` 会在最后 DELETE。`kind` ∈ `{meeting, agent, kb, invitation, action}`。

## 套件目前覆盖

29 用例 ✅ + 8 用例 ⏭️(都是真音频或浏览器 UI 限制) = 37 cases。

涵盖系列:
- A 账号、E 纠错、F-3 Agent、G 纪要、I 简报、J 历史、K Agent/LLM 后台、N 审计、Q 知识库、R 导出、V v8/9/12 回归、W 文字录入、X M3.0 自动主持人

不覆盖的硬约束:
- B 声纹录入、C ASR、D 声纹识别(真人声)
- W-12/W-13(浏览器麦权限拒绝)
- X-22/X-23/X-24(live banner 倒计时 UI)
