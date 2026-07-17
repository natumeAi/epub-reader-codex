import { describe, expect, it } from 'vitest';
import { inspectPageTurnDiagnosticRecords } from './page-turn-verification-assertions.mjs';

function diagnosticRecord(overrides = {}) {
  return {
    action: 'rollback',
    backend: 'compositor',
    cancelReason: null,
    endTime: 180,
    firstVisualTime: 16,
    frameTimestamps: [16, 32],
    ...overrides,
  };
}

describe('page-turn browser diagnostic assertions', () => {
  it('rejects a cancelled rollback even when it reached a terminal stable state', () => {
    const cancelledRollback = diagnosticRecord({ cancelReason: 'animation' });

    const result = inspectPageTurnDiagnosticRecords(
      [cancelledRollback],
      'compositor',
    );

    expect(result.invalidRecord).toBe(cancelledRollback);
  });

  it('requires visual timing evidence for successful records', () => {
    const missingVisualEvidence = diagnosticRecord({
      firstVisualTime: null,
      frameTimestamps: [],
    });

    const result = inspectPageTurnDiagnosticRecords(
      [missingVisualEvidence],
      'compositor',
    );

    expect(result.invalidRecord).toBe(missingVisualEvidence);
  });

  it('allows an explicitly expected cancelled preparation record', () => {
    const cancelledPreparation = diagnosticRecord({
      action: 'drag',
      cancelReason: 'cancelled',
      firstVisualTime: null,
      frameTimestamps: [],
    });
    const completedTap = diagnosticRecord({ action: 'tap-next' });

    const result = inspectPageTurnDiagnosticRecords(
      [cancelledPreparation, completedTap],
      'compositor',
      { allowCancelledActions: ['drag'] },
    );

    expect(result).toEqual({
      actions: ['drag', 'tap-next'],
      invalidRecord: null,
    });
  });
});
