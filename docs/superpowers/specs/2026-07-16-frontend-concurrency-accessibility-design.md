# Frontend Concurrency and Accessibility Design

## Goal

防止旧文件夹请求覆盖当前界面，并为阅读器、文件夹和删除确认弹窗提供一致的键盘焦点管理、Escape 关闭和减少动画行为。

## Scope

- 文件夹请求支持 AbortSignal 和请求代次。
- 打开新文件夹或关闭当前文件夹时中止旧请求。
- 三类模态界面共享焦点锁定和焦点恢复逻辑。
- 支持 Escape 关闭和 prefers-reduced-motion。
- 保持触摸拖拽、视觉布局和现有动画时长不变，除非用户明确要求减少动画。

## Non-goals

- 不重写 DnD 状态机。
- 不改变阅读器点击三区或滑动翻页手势。
- 不增加新的视觉控件。
- 不处理应用级路由或浏览器返回键。

## Folder request concurrency

### client/src/api/foldersApi.js

listFolderBooks(folderId, options = {}) 接受 signal，并将其传给 fetch。其他调用保持兼容。

### client/src/hooks/useFolderState.js

增加 folderRequestRef，保存 AbortController、递增 requestId 和 folderId。

handleOpenFolder：

1. 中止上一 controller。
2. requestId 加一并创建新 controller。
3. 设置 openFolder 和 loading。
4. 请求完成后，只有 requestId 和 folderId 仍匹配时才能写入 books、error 和 loading。
5. AbortError 静默结束，不清空新文件夹状态。

handleCloseFolder 和 finishCloseFolder 都中止当前请求并使 requestId 失效。组件卸载时执行相同清理。

refreshOpenFolderBooksOrClose 复用同一请求代次规则，避免删除或移动后的刷新响应覆盖后来打开的文件夹。

## Modal focus management

### client/src/hooks/useModalDialog.js

接口接收 open、onRequestClose、initialFocusRef 和 restoreFocus，返回 dialogRef 与 onKeyDown。

打开时：

- 保存 document.activeElement。
- 下一帧优先聚焦 initialFocusRef，否则聚焦第一个可用按钮、输入框或带 tabindex 的元素；没有可聚焦子元素时聚焦 dialog 根节点。
- dialog 根节点使用 tabIndex=-1。

键盘处理：

- Escape 阻止默认行为并调用 onRequestClose。
- Tab 在首尾可聚焦元素之间循环。
- disabled、hidden、aria-hidden 和不可见元素不进入循环。

关闭或卸载时：

- 若原元素仍连接在 document 中，则恢复焦点。
- restoreFocus 为 false 时跳过恢复。

### Component integration

- ReaderView：dialogRef 绑定 reader-overlay，初始焦点为 dialog 根节点；控制层显示后，返回书架按钮正常进入 Tab 顺序。
- FolderOverlay：dialogRef 绑定 folder-overlay，初始焦点为文件夹标题按钮或重命名输入框。
- DeleteConfirmDialog：dialogRef 绑定 delete-confirm-overlay，初始焦点为取消按钮。

现有 onClose 和保存中 guard 仍决定是否真正关闭，hook 不绕过业务保护。

## Reduced motion

新增 client/src/hooks/useReducedMotion.js，使用 matchMedia('(prefers-reduced-motion: reduce)') 并监听 change。

- ReaderView 在 reduce 模式下把打开、关闭和翻页视觉等待时间设为 0，但仍只调用一次 rendition.next 或 prev。
- useFolderState 在 reduce 模式下立即完成关闭，不等待 180ms。
- CSS media query 禁用书架排序、弹窗、面板和翻页的 transition/animation。
- loading spinner 保留，因为它表达进度而不是装饰性位移。

## Error handling

- AbortError 不显示为 folderError。
- 非 AbortError 只允许当前请求写入错误。
- 焦点目标在动画期间消失时，退回 dialog 根节点。
- matchMedia 不存在时默认不减少动画，保证旧浏览器兼容。

## Testing

- deferred Promise 测试：先打开 A，再打开 B；A 最后返回也不能覆盖 B。
- 关闭文件夹后旧请求完成，不得重新设置 books 或 error。
- AbortError 不显示错误，真实网络错误显示现有中文错误。
- 每个 modal 打开后焦点落到规定控件，Tab 和 Shift+Tab 保持在内部。
- Escape 调用一次现有关闭函数；关闭后焦点回到原触发按钮。
- emulateMedia reducedMotion: reduce 时，阅读器和文件夹关闭无需动画等待，翻页只执行一次。
- 现有触摸移动端 Playwright 验证继续通过。

## Acceptance criteria

- 任意请求完成顺序都只能呈现最后一次打开的文件夹。
- 三类 modal 满足焦点进入、焦点锁定、Escape 和焦点恢复。
- 减少动画设置不改变数据操作、翻页次数或最终界面状态。
