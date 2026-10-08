// i18n.js - locale detection + the single dictionary every user-facing
// DeepBlue string is pulled from. Three locales: 'en', 'zh-CN'
// (Mainland Chinese, simplified characters) and 'ru' (Russian).
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
      'folders.menu.addSub': 'Add subfolder',
      'folders.new.subname': 'New subfolder',
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

      'welcome.badge': 'Installed successfully',
      'welcome.title': 'You\u2019re all set!',
      'welcome.subtitle': 'Congratulations \u2013 DeepBlue is now supercharging your DeepSeek.',
      'welcome.body': 'No setup, no sign-up. Everything lives right inside DeepSeek. Here\u2019s what you just unlocked:',
      'welcome.f1.title': 'Instant search',
      'welcome.f1.desc': 'Find any chat or message in a flash.',
      'welcome.f2.title': 'Color folders',
      'welcome.f2.desc': 'Keep your chats neatly organized.',
      'welcome.f3.title': 'Bookmarks',
      'welcome.f3.desc': 'Pin the answers worth keeping.',
      'welcome.f4.title': 'Export anywhere',
      'welcome.f4.desc': 'Save as PDF, JSON or plain text.',
      'welcome.cta': 'Start exploring',
      'welcome.privacy': 'Private by design \u2013 your chats stay in your browser.',
      'welcome.dialog': 'Welcome to DeepBlue',

      'review.ctx.export': 'Your file is ready.',
      'review.ctx.default': 'Nice work!',
      'review.title': 'How is DeepBlue working for you?',
      'review.subtitle': 'Tap a star \u2013 it takes one second.',
      'review.label.1': 'Needs work',
      'review.label.2': 'Could be better',
      'review.label.3': 'Pretty good',
      'review.label.4': 'Really good',
      'review.label.5': 'Love it!',
      'review.star': '{n} of 5 stars',
      'review.happy.title': 'That means a lot \u2013 thank you!',
      'review.happy.body': 'A short public review helps other DeepSeek users discover DeepBlue. It takes under a minute.',
      'review.happy.cta': 'Write a review',
      'review.sad.title': 'Thanks for being honest.',
      'review.sad.body': 'Tell us what fell short and we\u2019ll work on it.',
      'review.sad.cta': 'Share feedback',
      'review.sad.alt': 'Leave a public review instead',
      'review.later': 'Maybe later',
      'review.never': 'Don\u2019t ask again',
      'review.close': 'Dismiss',
      'whatsnew.badge': 'New',
      'whatsnew.title': 'Subfolders are here',
      'whatsnew.body': 'Nest folders inside folders, as deep as you need, to keep every chat exactly where it belongs.',
      'whatsnew.hint': 'Hover any folder and tap + to add a subfolder inside it.',
      'whatsnew.cta': 'Got it',
      'whatsnew.demo1': 'Work',
      'whatsnew.demo2': 'Projects',
      'whatsnew.demo3': 'Ideas',
      'review.thanks': 'Thank you!',
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
      'folders.menu.addSub': '添加子文件夹',
      'folders.new.subname': '新建子文件夹',
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

      'welcome.badge': '安装成功',
      'welcome.title': '一切就绪！',
      'welcome.subtitle': '恭喜 — DeepBlue 已经开始为你的 DeepSeek 全面加速。',
      'welcome.body': '无需设置，无需注册，所有功能都直接内置在 DeepSeek 页面中。你刚刚解锁了：',
      'welcome.f1.title': '即时搜索',
      'welcome.f1.desc': '瞬间找到任意对话或消息。',
      'welcome.f2.title': '彩色文件夹',
      'welcome.f2.desc': '让你的对话井井有条。',
      'welcome.f3.title': '书签',
      'welcome.f3.desc': '把值得留下的回答标记起来。',
      'welcome.f4.title': '随处导出',
      'welcome.f4.desc': '保存为 PDF、JSON 或纯文本。',
      'welcome.cta': '开始探索',
      'welcome.privacy': '隐私优先 — 你的对话只保存在浏览器中。',
      'welcome.dialog': '欢迎使用 DeepBlue',

      'review.ctx.export': '文件已准备好。',
      'review.ctx.default': '做得不错！',
      'review.title': 'DeepBlue 用起来怎么样？',
      'review.subtitle': '点一下星星 — 只需一秒。',
      'review.label.1': '需要改进',
      'review.label.2': '还可以更好',
      'review.label.3': '不错',
      'review.label.4': '很好用',
      'review.label.5': '太喜欢了！',
      'review.star': '{n} 星（共 5 星）',
      'review.happy.title': '太感谢了！',
      'review.happy.body': '一条简短的公开评价能帮助更多 DeepSeek 用户发现 DeepBlue，只需不到一分钟。',
      'review.happy.cta': '撰写评价',
      'review.sad.title': '感谢你的坦诚。',
      'review.sad.body': '告诉我们哪里做得不够好，我们会努力改进。',
      'review.sad.cta': '提交反馈',
      'review.sad.alt': '改为公开评价',
      'review.later': '以后再说',
      'review.never': '不再提醒',
      'review.close': '关闭',
      'whatsnew.badge': '新功能',
      'whatsnew.title': '现在支持子文件夹了',
      'whatsnew.body': '文件夹里可以再建文件夹，层级不限，让每个对话都有它该在的位置。',
      'whatsnew.hint': '悬停在任意文件夹上，点击 + 即可在其中添加子文件夹。',
      'whatsnew.cta': '知道了',
      'whatsnew.demo1': '工作',
      'whatsnew.demo2': '项目',
      'whatsnew.demo3': '灵感',
      'review.thanks': '谢谢你！',
    },

    ru: {
      'toolbar.download.title': 'Скачать этот диалог (PDF, JSON или текст)',
      'toolbar.download.generating': 'Создание PDF\u2026',
      'toolbar.copy.title': 'Скопировать весь диалог как обычный текст',
      'toolbar.copy.copied': 'Скопировано!',
      'toolbar.copy.failed': 'Не удалось скопировать \u2013 попробуйте ещё раз',
      'toolbar.charCounter.title': 'Количество символов в вашем сообщении',
      'toolbar.charCounter.unit': 'симв.',

      'contextMeter.title.exact': 'Использовано {tokens} из {limit} токенов в этом диалоге',
      'contextMeter.title.estimate': 'Использовано около {tokens} из {limit} токенов (оценка)',

      'tokenCounter.title': 'Около {tokens} токенов в этом ответе',
      'tokenCounter.title.withTime': 'Около {tokens} токенов \u00b7 сгенерировано за {time}',
      'tokenCounter.unit': 'ток.',

      'tone.chip.label': 'Тон',
      'tone.chip.off.title': 'Задать тон ответа',
      'tone.chip.active.title': 'Тон: {label} \u2013 нажмите, чтобы изменить',
      'tone.popover.title': 'Тон ответа',
      'tone.popover.hint': 'Добавляется короткой меткой к вашему следующему сообщению.',
      'tone.option.off': 'Выкл.',
      'tone.option.off.title': 'Тон не задан \u2013 DeepSeek отвечает как обычно',
      'tone.option.title': 'Пометить сообщение: \u00ab{tag}\u00bb',
      'tone.add': 'Добавить свой тон',
      'tone.add.placeholder': 'например, саркастичный',
      'tone.remove.title': 'Удалить этот тон',
      'tone.tagOff': 'Tone: Off (ignore any earlier tone instructions - back to your normal, default tone)',
      'tone.tag': 'Tone: {label}',
      'tone.preset.friendly': 'Дружелюбный',
      'tone.preset.fun': 'Весёлый',
      'tone.preset.professional': 'Деловой',
      'tone.preset.concise': 'Краткий',
      'tone.preset.empathetic': 'Чуткий',

      'bookmarks.add.title': 'Добавить сообщение в закладки',
      'bookmarks.remove.title': 'Убрать из закладок',
      'bookmarks.launcher.title': 'Закладки в этом диалоге',
      'bookmarks.panel.title': 'Закладки в этом диалоге',
      'bookmarks.panel.close': 'Закрыть',
      'bookmarks.panel.empty': 'Закладок пока нет \u2013 наведите курсор на сообщение и нажмите значок закладки.',

      'folders.title': 'Папки',
      'folders.add.title': 'Создать новую папку',
      'folders.new.name': 'Новая папка',
      'folders.empty': 'Папок пока нет \u2013 нажмите +, чтобы создать',
      'folders.empty.drag': 'Пусто \u2013 перетащите сюда диалог',
      'folders.options.title': 'Параметры папки',
      'folders.menu.rename': 'Переименовать',
      'folders.menu.addSub': 'Добавить подпапку',
      'folders.new.subname': 'Новая подпапка',
      'folders.menu.color': 'Цвет',
      'folders.menu.delete': 'Удалить папку',
      'folders.assign.title': 'Добавить в папку',
      'folders.assign.empty': 'Папок пока нет. Нажмите + над поиском, чтобы создать.',
      'folders.item.remove.title': 'Убрать из этой папки',
      'folders.untitled': 'Диалог без названия',
      'folders.color.blue': 'Синий',
      'folders.color.purple': 'Фиолетовый',
      'folders.color.green': 'Зелёный',
      'folders.color.orange': 'Оранжевый',
      'folders.color.red': 'Красный',
      'folders.color.pink': 'Розовый',
      'folders.color.teal': 'Бирюзовый',
      'folders.color.gray': 'Серый',

      'search.chat.placeholder': 'Поиск в диалоге\u2026',
      'search.sidebar.placeholder': 'Поиск по диалогам\u2026',
      'search.prev.title': 'Предыдущее совпадение',
      'search.next.title': 'Следующее совпадение',
      'search.clear.title': 'Очистить поиск',

      'prompts.button.title': 'Сохранённые промпты для повторного использования',
      'prompts.panel.title': 'Библиотека промптов',
      'prompts.search.placeholder': 'Поиск промптов\u2026',
      'prompts.search.noMatch': 'Нет промптов, подходящих под запрос.',
      'prompts.row.title': 'Нажмите, чтобы вставить в сообщение',
      'prompts.edit.title': 'Изменить',
      'prompts.delete.title': 'Удалить',
      'prompts.add.title': 'Новый промпт',
      'prompts.empty': 'Сохранённых промптов пока нет. Добавьте первый ниже.',
      'prompts.form.titlePlaceholder': 'Название (например, \u00abОбъясни просто\u00bb)',
      'prompts.form.contentPlaceholder': 'Текст промпта\u2026',
      'prompts.form.save': 'Сохранить',
      'prompts.form.add': 'Добавить',
      'prompts.form.cancel': 'Отмена',
      'prompts.untitled': 'Промпт без названия',

      'download.as': 'Скачать как',
      'download.pdf.label': 'Документ PDF',
      'download.pdf.desc': 'Оформленный файл с разбивкой на страницы',
      'download.json.label': 'JSON',
      'download.json.desc': 'Структурированные данные для обработки',
      'download.txt.label': 'Обычный текст',
      'download.txt.desc': 'Простой файл .txt без форматирования',
      'download.noConversation': 'Пока нечего скачивать \u2013 сначала начните диалог.',
      'download.failed': 'Не удалось скачать. Попробуйте ещё раз.',

      'export.readFailed': 'Не удалось прочитать этот ответ. Попробуйте ещё раз.',
      'export.nothing': 'Нечего экспортировать.',
      'export.msgFailed': 'Не удалось экспортировать этот ответ. Попробуйте ещё раз.',
      'pdf.engineLoadFailed': `${BRAND_NAME} не удалось загрузить PDF-движок. Попробуйте обновить страницу.`,
      'pdf.inProgress': 'Экспорт уже выполняется, подождите немного.',
      'prompts.findBoxFailed': 'Поле ввода не найдено. Нажмите на него и попробуйте снова.',

      'qa.menuNotFound': 'Не удалось найти меню диалога. Попробуйте кнопку \u00ab\u00b7\u00b7\u00b7\u00bb.',
      'qa.renameNotFound': 'Меню переименования не открылось. Попробуйте кнопку \u00ab\u00b7\u00b7\u00b7\u00bb.',
      'qa.editNotFound': 'Не удалось найти кнопку редактирования этого сообщения.',

      'loading.working': 'Выполняется\u2026',
      'loading.pdf.whole': 'Создание PDF\u2026',
      'loading.pdf.engineFail': 'Не удалось загрузить PDF-движок',
      'loading.pdf.downloaded': 'PDF скачан!',
      'loading.pdf.failed': 'Не удалось экспортировать PDF',
      'loading.pdf.message': 'Создание PDF из этого ответа\u2026',
      'loading.done': 'Готово!',
      'loading.error': 'Что-то пошло не так',

      'msgExport.title': 'Скачать этот ответ',
      'msgExport.downloaded': 'Скачано!',

      'copyPlain.title': 'Скопировать ответ как обычный текст (без форматирования)',
      'copyPlain.copied': 'Скопировано!',

      'welcome.badge': 'Установлено успешно',
      'welcome.title': 'Всё готово!',
      'welcome.subtitle': 'Поздравляем \u2013 DeepBlue уже прокачивает ваш DeepSeek.',
      'welcome.body': 'Без настройки и регистрации: всё работает прямо внутри DeepSeek. Вот что вы только что получили:',
      'welcome.f1.title': 'Мгновенный поиск',
      'welcome.f1.desc': 'Находите любой диалог или сообщение за секунду.',
      'welcome.f2.title': 'Цветные папки',
      'welcome.f2.desc': 'Держите диалоги в идеальном порядке.',
      'welcome.f3.title': 'Закладки',
      'welcome.f3.desc': 'Сохраняйте ответы, которые важно не потерять.',
      'welcome.f4.title': 'Экспорт куда угодно',
      'welcome.f4.desc': 'PDF, JSON или обычный текст.',
      'welcome.cta': 'Начать',
      'welcome.privacy': 'Приватность по умолчанию \u2013 ваши диалоги остаются в браузере.',
      'welcome.dialog': 'Добро пожаловать в DeepBlue',

      'review.ctx.export': 'Ваш файл готов.',
      'review.ctx.default': 'Отлично!',
      'review.title': 'Как вам DeepBlue?',
      'review.subtitle': 'Нажмите на звезду \u2013 это займёт секунду.',
      'review.label.1': 'Нужно доработать',
      'review.label.2': 'Могло быть лучше',
      'review.label.3': 'Неплохо',
      'review.label.4': 'Очень хорошо',
      'review.label.5': 'Обожаю!',
      'review.star': '{n} из 5 звёзд',
      'review.happy.title': 'Это очень ценно \u2013 спасибо!',
      'review.happy.body': 'Короткий публичный отзыв поможет другим пользователям DeepSeek найти DeepBlue. Это займёт меньше минуты.',
      'review.happy.cta': 'Написать отзыв',
      'review.sad.title': 'Спасибо за честность.',
      'review.sad.body': 'Расскажите, что не понравилось, и мы это исправим.',
      'review.sad.cta': 'Оставить обратную связь',
      'review.sad.alt': 'Оставить публичный отзыв',
      'review.later': 'Позже',
      'review.never': 'Больше не спрашивать',
      'review.close': 'Закрыть',
      'whatsnew.badge': 'Новинка',
      'whatsnew.title': 'Теперь есть подпапки',
      'whatsnew.body': 'Вкладывайте папки в папки на любую глубину, чтобы каждый диалог лежал на своём месте.',
      'whatsnew.hint': 'Наведите курсор на папку и нажмите +, чтобы добавить в неё подпапку.',
      'whatsnew.cta': 'Понятно',
      'whatsnew.demo1': 'Работа',
      'whatsnew.demo2': 'Проекты',
      'whatsnew.demo3': 'Идеи',
      'review.thanks': 'Спасибо!',
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
    if (htmlLang.startsWith('ru')) return 'ru';
    if (htmlLang.startsWith('en')) return 'en';

    const navLang = (navigator.language || '').toLowerCase();
    if (navLang.startsWith('zh')) return 'zh-CN';
    if (navLang.startsWith('ru')) return 'ru';

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
