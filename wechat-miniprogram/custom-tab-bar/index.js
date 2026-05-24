// custom-tab-bar/index.js — v27.2 自定义 tabBar 组件
//
// 用 自定义 tabBar (app.json tabBar.custom=true) 替代 之前 各页 自己画的
// <view class="navbar"> + wx.reLaunch 切 tab.
//
// 为什么:
//   wx.reLaunch 切 tab 会 销毁整页栈 + 重建目标页 → 销毁/重建/首渲之间 白屏,
//   叠加 lazyCodeLoading 更长. 原生 tabBar 4 个 tab 页 常驻, wx.switchTab
//   只是 显示/隐藏 已渲染好的页 → 秒切, 零白屏.
//
// selected 状态: 每个 tab 页 onShow 里 调 this.getTabBar().setData({selected})
// 同步高亮 (微信自定义 tabBar 标准做法).

Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home',                   text: '今日', emoji: '🎯' },
      { pagePath: '/pages/meetings_list/meetings_list',  text: '会议', emoji: '📅' },
      { pagePath: '/pages/tasks_list/tasks_list',        text: '任务', emoji: '✓' },
      { pagePath: '/pages/insights/insights',            text: '记忆', emoji: '🧠' },
    ],
  },

  methods: {
    onTap(e) {
      const idx = e.currentTarget.dataset.index;
      if (idx === this.data.selected) return;
      const item = this.data.list[idx];
      if (!item) return;
      wx.switchTab({
        url: item.pagePath,
        fail: (err) => console.error('[tabbar] switchTab fail', err),
      });
    },
  },
});
