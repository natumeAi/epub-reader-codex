export function inspectPageTurnDiagnosticRecords(
  records,
  expectedBackend,
  { allowCancelledActions = [] } = {},
) {
  const allowedCancellations = new Set(allowCancelledActions);
  return {
    actions: records.map((record) => record.action),
    invalidRecord: records.find((record) => {
      if (
        record.backend !== expectedBackend ||
        !Number.isFinite(record.endTime)
      ) {
        return true;
      }

      if (record.cancelReason !== null) {
        return !allowedCancellations.has(record.action);
      }

      return !Number.isFinite(record.firstVisualTime) ||
        !Array.isArray(record.frameTimestamps) ||
        record.frameTimestamps.length === 0;
    }) || null,
  };
}
