// pages/picker/picker.js — v27.0-mobile P19-B 微信聊天记录文件选择器
//
// 入口:
//   H5 (web-view 内) 调 wx.miniProgram.navigateTo({
//     url: '/pages/picker/picker?draft_id=<uuid>'    // 创建会议前 用
//     // 或 '/pages/picker/picker?meeting_id=<uuid>' // 给已创建会议 加附件
//   })
//
// 流程:
//   1. onLoad 拿 draft_id / meeting_id from query.
//   2. 用户点 "从聊天记录选" → wx.chooseMessageFile.
//   3. 每个 tempFilePath → wx.uploadFile (multipart) 到 后端 endpoint.
//   4. 所有上传完 → wx.navigateBack 回 webview. H5 visibility-change 自动 重拉.
//
// 失败:
//   - 单个文件失败 不阻塞其他, 仅 toast 提示.
//   - 网络全挂 → 留在本页, 让用户重试.

const app = getApp();

const ALLOWED_EXT = [
  "pdf",
  "docx",
  "xlsx",
  "xls",
  "txt",
  "md",
  "csv",
  "log",
  "json",
  "yaml",
  "yml",
  "jpg",
  "jpeg",
  "png",
  "bmp",
  "tiff",
  "tif",
  "webp",
  "gif",
];

const MAX_BYTES = 50 * 1024 * 1024; // 50MB / 份, 跟后端一致

Page({
  data: {
    draftId: "",
    meetingId: "",
    uploading: false,
    // 已上传成功 的文件 — 仅本页 session 显, 不持久化 (H5 端有完整列表)
    uploaded: [], // [{ name, size, status }]
    errorText: "",
  },

  onLoad(options) {
    this.setData({
      draftId: options.draft_id || "",
      meetingId: options.meeting_id || "",
    });
    if (!options.draft_id && !options.meeting_id) {
      this.setData({
        errorText: "缺少 draft_id / meeting_id — 请从 H5 创建会议页 进入",
      });
    }
  },

  onChooseFiles() {
    if (this.data.uploading) return;
    wx.chooseMessageFile({
      count: 10,
      type: "file",
      extension: ALLOWED_EXT,
      success: (res) => {
        this.uploadAll(res.tempFiles || []);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf("cancel") < 0) {
          this.setData({ errorText: "选文件失败: " + err.errMsg });
        }
      },
    });
  },

  async uploadAll(files) {
    if (!files.length) return;
    // 客户端先 过 一次大小 + ext (后端会再 校验, 这里 只是 早 fail 体验更好)
    const accepted = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        wx.showToast({
          title: `${f.name} 超 50MB`,
          icon: "none",
          duration: 2000,
        });
        continue;
      }
      const ext = (f.name || "").split(".").pop().toLowerCase();
      if (ALLOWED_EXT.indexOf(ext) < 0) {
        wx.showToast({
          title: `${f.name} 格式不支持`,
          icon: "none",
          duration: 2000,
        });
        continue;
      }
      accepted.push(f);
    }
    if (!accepted.length) return;

    this.setData({ uploading: true, errorText: "" });
    for (const f of accepted) {
      try {
        await this.uploadOne(f);
        const uploaded = this.data.uploaded.concat([
          { name: f.name, size: f.size, status: "✓ 已上传" },
        ]);
        this.setData({ uploaded });
      } catch (e) {
        const msg = e && e.errMsg ? e.errMsg : String(e);
        const uploaded = this.data.uploaded.concat([
          { name: f.name, size: f.size, status: "✗ " + msg.slice(0, 30) },
        ]);
        this.setData({ uploaded });
      }
    }
    this.setData({ uploading: false });
  },

  uploadOne(file) {
    return new Promise((resolve, reject) => {
      const formData = {};
      if (this.data.draftId) formData.client_draft_id = this.data.draftId;
      if (this.data.meetingId) formData.meeting_id = this.data.meetingId;

      wx.uploadFile({
        url: app.globalData.h5Base + "/api/meetings/attachments",
        filePath: file.path,
        name: "file",
        formData,
        timeout: 120000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res);
          } else {
            let detail = "";
            try {
              detail = (JSON.parse(res.data) || {}).detail || "";
            } catch (_) {
              detail = "";
            }
            reject({
              errMsg:
                "HTTP " + res.statusCode + (detail ? " " + detail : ""),
            });
          }
        },
        fail: reject,
      });
    });
  },

  onDone() {
    // 回 web-view. H5 端 onVisible / visibility-change 时 自己拉 attachments 新列表.
    wx.navigateBack({
      delta: 1,
      fail: () => {
        // 没历史可退 (例: 用户从首页深链进来) → switchTab 回 webview
        wx.reLaunch({ url: "/pages/webview/webview" });
      },
    });
  },

  formatSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  },
});
