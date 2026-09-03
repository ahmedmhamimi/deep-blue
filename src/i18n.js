// i18n.js - locale detection + the single dictionary every user-facing
// DeepBlue string is pulled from. Two locales for now: 'en' and 'zh-CN'
// (Mainland Chinese, simplified characters).
//
// Detection order (first match wins):
//   1. An explicit override saved earlier via Lang.setLocale() (nobody's
//      exposed a UI for this yet, but the mechanism is there for a future
//      settings toggle).
//   2. DeepSeek's own <html lang="..."> - this reflects the language the
//      person has actually chosen for the SITE ITSELF (via their DeepSeek
//      account settings), which is a much stronger signal than the
//      browser's locale: someone can run an English browser while using
//      DeepSeek in Chinese, or vice versa, and DeepBlue should match
//      DeepSeek, not the OS.
//   3. navigator.language, as a last resort for the rare case DeepSeek
//      hasn't set `lang` yet when this first runs.
//
// Depends on: nothing. Must load before any feature that renders text, so
// it sits right after config.js/theme.js in manifest.json's
// content_scripts[].js array.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array.

'use strict';

const Lang = {
  _storageKey: 'deepblue-locale-v1',
  _locale: null,

  _dict: {
    en: {
      'toolbar.download.title': 'Download this conversation (PDF, JSON, or text)',
      'toolbar.download.generating': 'Generating PDF\u2026',
      'toolbar.copy.title': 'Copy the whole conversation as plain text',
      'toolbar.copy.copied': 'Copied!',
      'toolbar.copy.failed': 'Couldn\u2019t copy \u2013 please try again',
      'toolbar.charCounter.title': 'Number of characters in your message',
      'toolbar.charCounter.unit': 'characters',

      'contextMeter.title.exact': '{tokens} of {limit} tokens used in this conversation',
      'contextMeter.title.estimate': 'About {tokens} of {limit} tokens used (estimated)',

      'tokenCounter.title': 'About {tokens} tokens in this response',
      'tokenCounter.title.withTime': 'About {tokens} tokens \u00b7 generated in {time}',
      'tokenCounter.unit': 'tokens',

      'tone.chip.label': 'Tone',
      'tone.chip.off.title': 'Set a tone for the reply',
      'tone.chip.active.title': 'Tone: {label} \u2013 tap to change',
      'tone.popover.title': 'Response tone',
      'tone.popover.hint': 'Added as a short tag on your next message.',
      'tone.option.off': 'Off',
      'tone.option.off.title': 'No tone set \u2013 DeepSeek replies normally',
      'tone.option.title': 'Tag your message: \u201c{tag}\u201d',
      'tone.add': 'Add a custom tone',
      'tone.add.placeholder': 'e.g. sarcastic',
      'tone.remove.title': 'Remove this tone',
      'tone.tagOff': 'Tone: Off (ignore any earlier tone instructions - back to your normal, default tone)',
      'tone.tag': 'Tone: {label}',
      'tone.preset.friendly': 'Friendly',
      'tone.preset.fun': 'Fun',
      'tone.preset.professional': 'Professional',
      'tone.preset.concise': 'Concise',
      'tone.preset.empathetic': 'Empathetic',

      'bookmarks.add.title': 'Bookmark this message',
      'bookmarks.remove.title': 'Remove bookmark',
      'bookmarks.launcher.title': 'View bookmarked messages in this chat',
      'bookmarks.panel.title': 'Bookmarks in this chat',
      'bookmarks.panel.close': 'Close',
      'bookmarks.panel.empty': 'No bookmarks yet \u2013 hover a message and tap the bookmark icon.',

      'folders.title': 'Folders',
      'folders.add.title': 'Create a new folder',
      'folders.new.name': 'New folder',
      'folders.empty': 'No folders yet \u2013 tap + to create one',
      'folders.empty.drag': 'Empty \u2013 drag a chat here',
      'folders.options.title': 'Folder options',
      'folders.menu.rename': 'Rename',
      'folders.menu.color': 'Color',
      'folders.menu.delete': 'Delete folder',
      'folders.assign.title': 'Add to folder',
      'folders.assign.empty': 'No folders yet. Tap + above search to create one.',
      'folders.item.remove.title': 'Remove from this folder',
      'folders.untitled': 'Untitled conversation',
      'folders.color.blue': 'Blue',
      'folders.color.purple': 'Purple',
      'folders.color.green': 'Green',
      'folders.color.orange': 'Orange',
      'folders.color.red': 'Red',
      'folders.color.pink': 'Pink',
      'folders.color.teal': 'Teal',
      'folders.color.gray': 'Gray',

      'search.chat.placeholder': 'Search in conversation\u2026',
      'search.sidebar.placeholder': 'Search conversations\u2026',
      'search.prev.title': 'Previous match',
      'search.next.title': 'Next match',
      'search.clear.title': 'Clear search',

      'prompts.button.title': 'Saved prompts you can reuse',
      'prompts.panel.title': 'Prompt Library',
      'prompts.search.placeholder': 'Search prompts\u2026',
      'prompts.search.noMatch': 'No prompts match your search.',
      'prompts.row.title': 'Tap to insert into your message',
      'prompts.edit.title': 'Edit',
      'prompts.delete.title': 'Delete',
      'prompts.add.title': 'New prompt',
      'prompts.empty': 'No saved prompts yet. Add your first one below.',
      'prompts.form.titlePlaceholder': 'Title (e.g. "Explain simply")',
      'prompts.form.contentPlaceholder': 'Prompt text\u2026',
      'prompts.form.save': 'Save',
      'prompts.form.add': 'Add',
      'prompts.form.cancel': 'Cancel',
      'prompts.untitled': 'Untitled prompt',

      'download.as': 'Download as',
      'download.pdf.label': 'PDF document',
      'download.pdf.desc': 'Formatted, paginated file',
      'download.json.label': 'JSON',
      'download.json.desc': 'Structured data, easy to parse',
      'download.txt.label': 'Plain text',
      'download.txt.desc': 'Simple .txt file, no formatting',
      'download.noConversation': 'No conversation to download yet \u2013 start chatting first.',
      'download.failed': 'Couldn\u2019t download the conversation. Please try again.',

      'export.readFailed': 'Couldn\u2019t read this response. Please try again.',
      'export.nothing': 'Nothing to export.',
      'export.msgFailed': 'Couldn\u2019t export this response. Please try again.',
      'pdf.engineLoadFailed': `${BRAND_NAME} couldn\u2019t load its PDF engine. Try reloading the page.`,
      'pdf.inProgress': 'An export is already in progress \u2013 please wait for it to finish.',
      'prompts.findBoxFailed': 'Couldn\u2019t find the message box. Click into it and try again.',

      'qa.menuNotFound': 'Couldn\u2019t find the conversation menu \u2013 try the \u2022\u2022\u2022 button.',
      'qa.renameNotFound': 'Rename menu didn\u2019t open \u2013 try the \u2022\u2022\u2022 button.',
      'qa.editNotFound': 'Couldn\u2019t find the edit button for this message.',

      'loading.working': 'Working\u2026',
      'loading.pdf.whole': 'Generating your PDF\u2026',
      'loading.pdf.engineFail': 'Couldn\u2019t load the PDF engine',
      'loading.pdf.downloaded': 'PDF downloaded!',
      'loading.pdf.failed': 'PDF export failed',
      'loading.pdf.message': 'Generating this response as a PDF\u2026',
      'loading.done': 'Done!',
      'loading.error': 'Something went wrong',

      'msgExport.title': 'Download this response',
      'msgExport.downloaded': 'Downloaded!',

      'copyPlain.title': 'Copy this reply as plain text (no formatting)',
      'copyPlain.copied': 'Copied!',
    },

    'zh-CN': {
      'toolbar.download.title': '下载整段对话（PDF、JSON 或文本）',
      'toolbar.download.generating': '正在生成 PDF…',
      'toolbar.copy.title': '复制整段对话为纯文本',
      'toolbar.copy.copied': '已复制！',
      'toolbar.copy.failed': '复制失败，请重试',
      'toolbar.charCounter.title': '你输入内容的字符数',
      'toolbar.charCounter.unit': '字符',

      'contextMeter.title.exact': '本次对话已使用 {tokens} / {limit} 个 token',
      'contextMeter.title.estimate': '本次对话预计已使用约 {tokens} / {limit} 个 token',

      'tokenCounter.title': '这条回复约 {tokens} 个 token',
      'tokenCounter.title.withTime': '约 {tokens} 个 token · 用时 {time}',
      'tokenCounter.unit': 'token',

      'tone.chip.label': '语气',
      'tone.chip.off.title': '为回复设置语气',
      'tone.chip.active.title': '语气：{label} — 点击更改',
      'tone.popover.title': '回复语气',
      'tone.popover.hint': '会作为一段简短标签，附加到你的下一条消息末尾。',
      'tone.option.off': '关闭',
      'tone.option.off.title': '未设置语气 — DeepSeek 将正常回复',
      'tone.option.title': '为消息添加标签：“{tag}”',
      'tone.add': '添加自定义语气',
      'tone.add.placeholder': '例如：毒舌',
      'tone.remove.title': '删除该语气',
      'tone.tagOff': 'Tone: Off (ignore any earlier tone instructions - back to your normal, default tone)',
      'tone.tag': 'Tone: {label}',
      'tone.preset.friendly': '友好',
      'tone.preset.fun': '风趣',
      'tone.preset.professional': '专业',
      'tone.preset.concise': '简洁',
      'tone.preset.empathetic': '温暖',

      'bookmarks.add.title': '收藏这条消息',
      'bookmarks.remove.title': '取消收藏',
      'bookmarks.launcher.title': '查看本次对话中收藏的消息',
      'bookmarks.panel.title': '本次对话的收藏',
      'bookmarks.panel.close': '关闭',
      'bookmarks.panel.empty': '还没有收藏 — 将鼠标移到消息上，点击收藏图标即可。',

      'folders.title': '文件夹',
      'folders.add.title': '新建文件夹',
      'folders.new.name': '新建文件夹',
      'folders.empty': '还没有文件夹 — 点击 + 创建一个',
      'folders.empty.drag': '空文件夹 — 把对话拖到这里',
      'folders.options.title': '文件夹选项',
      'folders.menu.rename': '重命名',
      'folders.menu.color': '颜色',
      'folders.menu.delete': '删除文件夹',
      'folders.assign.title': '添加到文件夹',
      'folders.assign.empty': '还没有文件夹，点击搜索框上方的 + 创建一个。',
      'folders.item.remove.title': '从此文件夹中移除',
      'folders.untitled': '未命名对话',
      'folders.color.blue': '蓝色',
      'folders.color.purple': '紫色',
      'folders.color.green': '绿色',
      'folders.color.orange': '橙色',
      'folders.color.red': '红色',
      'folders.color.pink': '粉色',
      'folders.color.teal': '青色',
      'folders.color.gray': '灰色',

      'search.chat.placeholder': '搜索当前对话…',
      'search.sidebar.placeholder': '搜索对话…',
      'search.prev.title': '上一个匹配项',
      'search.next.title': '下一个匹配项',
      'search.clear.title': '清空搜索',

      'prompts.button.title': '可重复使用的常用提示语',
      'prompts.panel.title': '提示语库',
      'prompts.search.placeholder': '搜索提示语…',
      'prompts.search.noMatch': '没有匹配的提示语。',
      'prompts.row.title': '点击插入到你的消息中',
      'prompts.edit.title': '编辑',
      'prompts.delete.title': '删除',
      'prompts.add.title': '新建提示语',
      'prompts.empty': '还没有保存的提示语，在下面添加第一条吧。',
      'prompts.form.titlePlaceholder': '标题（例如“简单解释一下”）',
      'prompts.form.contentPlaceholder': '提示语内容…',
      'prompts.form.save': '保存',
      'prompts.form.add': '添加',
      'prompts.form.cancel': '取消',
      'prompts.untitled': '未命名提示语',

      'download.as': '下载格式',
      'download.pdf.label': 'PDF 文档',
      'download.pdf.desc': '带排版的分页文件',
      'download.json.label': 'JSON',
      'download.json.desc': '结构化数据，便于解析',
      'download.txt.label': '纯文本',
      'download.txt.desc': '简单的 .txt 文件，不含格式',
      'download.noConversation': '暂时还没有可下载的对话，先聊几句吧。',
      'download.failed': '下载失败，请重试。',

      'export.readFailed': '无法读取这条回复，请重试。',
      'export.nothing': '没有可导出的内容。',
      'export.msgFailed': '导出这条回复失败，请重试。',
      'pdf.engineLoadFailed': `${BRAND_NAME} 未能加载 PDF 引擎，请尝试刷新页面。`,
      'pdf.inProgress': '已有一个导出任务正在进行，请稍候。',
      'prompts.findBoxFailed': '未找到输入框，请先点击输入框再试一次。',

      'qa.menuNotFound': '没找到对话菜单，请试试「···」按钮。',
      'qa.renameNotFound': '重命名菜单没有打开，请试试「···」按钮。',
      'qa.editNotFound': '没找到这条消息的编辑按钮。',

      'loading.working': '正在处理…',
      'loading.pdf.whole': '正在生成 PDF…',
      'loading.pdf.engineFail': 'PDF 引擎加载失败',
      'loading.pdf.downloaded': 'PDF 已下载！',
      'loading.pdf.failed': 'PDF 导出失败',
      'loading.pdf.message': '正在将这条回复生成 PDF…',
      'loading.done': '完成！',
      'loading.error': '出了点问题',

      'msgExport.title': '下载这条回复',
      'msgExport.downloaded': '已下载！',

      'copyPlain.title': '复制这条回复为纯文本（不含格式）',
      'copyPlain.copied': '已复制！',
    },
  },

  detect() {
    try {
      const saved = localStorage.getItem(this._storageKey);
      if (saved && this._dict[saved]) return saved;
    } catch (err) {
      // localStorage can throw in some locked-down contexts; fall through
      // to live detection below.
    }

    const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    if (htmlLang.startsWith('zh')) return 'zh-CN';
    if (htmlLang.startsWith('en')) return 'en';

    const navLang = (navigator.language || '').toLowerCase();
    if (navLang.startsWith('zh')) return 'zh-CN';

    return 'en';
  },

  locale() {
    if (!this._locale) this._locale = this.detect();
    return this._locale;
  },

  // Not wired to any UI yet, but here so a future settings toggle doesn't
  // need to touch anything else.
  setLocale(locale) {
    if (!this._dict[locale]) return;
    this._locale = locale;
    try {
      localStorage.setItem(this._storageKey, locale);
    } catch (err) {
      // Non-fatal - the in-memory override for this page load still works.
    }
  },

  // Re-detects in case DeepSeek's own language setting changes at runtime
  // (its `<html lang>` can flip without a full page reload).
  sync() {
    const detected = this.detect();
    if (detected !== this._locale) this._locale = detected;
  },

  // t('some.key', { name: 'value' }) -> looks up the current locale's
  // string, falling back to English, then to the key itself so a missing
  // translation is at worst an English string, never a crash.
  t(key, vars) {
    const table = this._dict[this.locale()] || this._dict.en;
    let str = table[key] ?? this._dict.en[key] ?? key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
      });
    }
    return str;
  },
};
