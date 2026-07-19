const LAYOUT_EPSILON = 1;

export function inspectBookshelfLayout(snapshot) {
  const errors = [];
  const {
    app,
    continueCards = [],
    continueSection,
    continueViewport,
    documentScrollWidth,
    firstShelfRow = [],
    search,
    touchTargets = [],
    viewport,
  } = snapshot;

  if (documentScrollWidth > viewport.width + LAYOUT_EPSILON) {
    errors.push('页面存在横向溢出');
  }

  if (viewport.width === 430 && viewport.height === 932) {
    const firstRowFits = firstShelfRow.length > 0 && firstShelfRow.every(
      (item) => item.top >= 0 && item.bottom <= viewport.height + LAYOUT_EPSILON,
    );
    if (
      !search ||
      !continueSection ||
      search.bottom > viewport.height + LAYOUT_EPSILON ||
      continueSection.bottom > viewport.height + LAYOUT_EPSILON ||
      !firstRowFits
    ) {
      errors.push('430×932 首屏未完整显示搜索、继续阅读和一整排书架');
    }

    const [firstCard, secondCard] = continueCards;
    const firstCardIsComplete = Boolean(
      continueViewport &&
      firstCard &&
      firstCard.left >= continueViewport.left - LAYOUT_EPSILON &&
      firstCard.right <= continueViewport.right + LAYOUT_EPSILON,
    );
    const secondCardPeeks = Boolean(
      continueViewport &&
      secondCard &&
      secondCard.left < continueViewport.right - LAYOUT_EPSILON &&
      secondCard.right > continueViewport.right + LAYOUT_EPSILON,
    );
    if (!firstCardIsComplete || !secondCardPeeks) {
      errors.push('继续阅读卡片未满足第一张完整且第二张部分露出');
    }
  }

  if (
    viewport.width === 320 &&
    touchTargets.some((target) => target.width < 44 || target.height < 44)
  ) {
    errors.push('存在小于 44px 的主要控件');
  }

  if (viewport.width >= 760) {
    if (app.width > 760 + LAYOUT_EPSILON) {
      errors.push('宽屏应用外壳超过 760px');
    }
    if (Math.abs(app.left - (viewport.width - app.right)) > LAYOUT_EPSILON) {
      errors.push('宽屏应用外壳未居中');
    }
  }

  return errors;
}

export function inspectBookshelfSearch(snapshot) {
  const errors = [];

  if (snapshot.durationMs >= 100) {
    errors.push('本地搜索耗时未低于 100ms');
  }
  if (snapshot.typedRequestCount !== 0) {
    errors.push('输入搜索词后发起了 API 请求');
  }
  if (!snapshot.folderContextVisible) {
    errors.push('文件夹内命中未显示文件夹上下文');
  }
  if (snapshot.readOnlyItemCount < 1) {
    errors.push('搜索结果未使用只读卡片');
  }
  if (snapshot.dragHandleCount !== 0) {
    errors.push('搜索结果仍包含拖动句柄');
  }

  return errors;
}
