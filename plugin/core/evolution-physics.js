'use strict';

const DEFAULT_ALLOWED_MUTATION_TARGETS = new Set([
  'AGENTS.md',
  'TOOLS.md',
  'SOUL.md',
  'MEMORY.md',
  'runtime-config',
  'implementation-task',
  'research-review',
]);

function evaluatePressure({ trace, promotion, state, pluginConfig } = {}) {
  const impact = clamp01(Number(promotion?.impactScore ?? trace?.impactScore ?? 0));
  const failurePressure = trace?.result === 'failure' || trace?.result === 'partial'
    ? 0.25
    : 0;
  const researchPressure = pressureFromResearchAssessment(promotion?.researchAssessment);
  const accumulatedFailurePressure = clamp01(Number(state?.grao?.knownFailureCount || 0) * 0.03);
  const score = clamp01(impact + failurePressure + researchPressure + accumulatedFailurePressure);
  const threshold = resolvePressureThreshold(promotion, pluginConfig);

  return {
    score: round2(score),
    threshold: round2(threshold),
    passed: score >= threshold,
    components: {
      impact: round2(impact),
      failure: round2(failurePressure),
      research: round2(researchPressure),
      accumulatedFailures: round2(accumulatedFailurePressure),
    },
  };
}

function applyConservationLaw(promotion, { pluginConfig } = {}) {
  const allowedTargets = resolveAllowedTargets(pluginConfig);
  const autonomousApprovals = isAutonomousApprovalsEnabled(pluginConfig);
  const next = {
    ...promotion,
    validationRequired: filterHumanReview(
      uniqueStrings(promotion?.validationRequired || []),
      autonomousApprovals,
    ),
    autoApplyEligible: promotion?.autoApplyEligible === true,
  };
  const violations = [];

  if (!allowedTargets.has(String(next.mutationTarget || ''))) {
    violations.push({
      kind: 'mutation-target',
      value: next.mutationTarget || null,
      action: 'blocked-until-boundary-is-expanded',
    });
    next.applyMode = 'blocked';
    next.autoApplyEligible = false;
    next.validationRequired = uniqueStrings([
      ...next.validationRequired,
      'conservation-law',
    ]);
  }

  if (next.applyMode === 'config-patch' || next.mutationTarget === 'runtime-config') {
    next.validationRequired = uniqueStrings([
      ...next.validationRequired,
      'schema',
      'rollback',
    ]);
  }

  if (
    next.proposalType === 'policy'
    || next.mutationTarget === 'AGENTS.md'
    || next.mutationTarget === 'SOUL.md'
  ) {
    next.validationRequired = uniqueStrings([
      ...next.validationRequired,
      'conservation-law',
    ]);
  }

  if (autonomousApprovals && violations.length === 0 && next.applyMode !== 'blocked') {
    next.autoApplyEligible = true;
  }

  return {
    promotion: {
      ...next,
      physics: {
        ...(next.physics || {}),
        conservation: {
          passed: violations.length === 0,
          conserved: [
            'identity',
            'permissions',
            'safety-boundaries',
            'workspace-boundaries',
            'rollback-path',
          ],
          violations,
        },
      },
    },
    passed: violations.length === 0,
    violations,
  };
}

function prepareEvolutionProposal({ trace, promotion, state, pluginConfig } = {}) {
  const pressure = evaluatePressure({ trace, promotion, state, pluginConfig });
  if (!pressure.passed) {
    return {
      queued: false,
      reason: 'pressure-below-threshold',
      pressure,
      promotion: attachPhysics(promotion, { pressure }),
    };
  }

  const conservation = applyConservationLaw(attachPhysics(promotion, { pressure }), { pluginConfig });
  return {
    queued: true,
    reason: conservation.passed
      ? 'pressure-and-conservation-passed'
      : 'conservation-blocked-manual-review-only',
    pressure,
    conservation: {
      passed: conservation.passed,
      violations: conservation.violations,
    },
    promotion: conservation.promotion,
  };
}

function pressureFromResearchAssessment(assessment) {
  if (!assessment) return 0;
  const confidence = clamp01(Number(assessment.confidence || 0));
  const novelty = clamp01(Number(assessment.novelty || 0));
  const expectedImpact = String(assessment.expectedImpact || '');
  const impactBonus = expectedImpact === 'high' ? 0.1 : expectedImpact === 'medium' ? 0.05 : 0;
  return clamp01((confidence * 0.08) + (novelty * 0.08) + impactBonus);
}

function resolvePressureThreshold(promotion, pluginConfig = {}) {
  const thresholds = pluginConfig?.pressureThresholds || pluginConfig?.evolution?.pressureThresholds || {};
  const type = String(promotion?.proposalType || 'default');
  const configured = thresholds[type] ?? thresholds.default;
  if (Number.isFinite(Number(configured))) return clamp01(Number(configured));
  if (type === 'research') return 0.7;
  if (type === 'memory') return 0.6;
  return 0.65;
}

function resolveAllowedTargets(pluginConfig = {}) {
  const configured = pluginConfig?.conservation?.allowedMutationTargets
    || pluginConfig?.allowedMutationTargets;
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_ALLOWED_MUTATION_TARGETS;
  }
  return new Set(configured.map((target) => String(target)));
}

function isAutonomousApprovalsEnabled(pluginConfig = {}) {
  return pluginConfig?.autonomousApprovals === true
    || pluginConfig?.evolution?.autonomousApprovals === true;
}

function filterHumanReview(values, autonomousApprovals) {
  if (!autonomousApprovals) return values;
  return values.filter((value) => value !== 'human-review');
}

function attachPhysics(promotion, patch) {
  return {
    ...promotion,
    physics: {
      ...(promotion?.physics || {}),
      ...patch,
    },
  };
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map((value) => String(value)))];
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = {
  evaluatePressure,
  applyConservationLaw,
  prepareEvolutionProposal,
  isAutonomousApprovalsEnabled,
};
