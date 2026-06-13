'use strict';

const fs = require('fs');
const path = require('path');

function createPromotionApplier(ctx = {}) {
  const {
    store,
    mutationRoot,
    preparePromotion,
    notifyQueuedPromotion,
    readNotificationSessionKey,
  } = ctx;

  if (!store) throw new Error('createPromotionApplier requires a store');
  if (!mutationRoot) throw new Error('createPromotionApplier requires a mutationRoot');

  return {
    apply(promotion, meta = {}) {
      const appliedAt = new Date().toISOString();
      const baseRecord = {
        proposalId: promotion.id,
        proposalType: promotion.proposalType,
        mutationTarget: promotion.mutationTarget,
        applyMode: promotion.applyMode,
        appliedAt,
        reviewer: meta.reviewer || 'agent',
        note: meta.note || null,
        status: 'noop',
        details: null,
      };

      if (promotion.applyMode === 'blocked' || promotion?.physics?.conservation?.passed === false) {
        const violations = promotion?.physics?.conservation?.violations || [];
        const record = {
          ...baseRecord,
          status: 'blocked',
          details: violations.length > 0
            ? `Conservation law blocked mutation: ${violations.map((violation) => `${violation.kind}:${violation.value}`).join(', ')}.`
            : 'Conservation law blocked mutation.',
        };
        store.appendAppliedMutation(record);
        return record;
      }

      if (promotion.proposalType === 'research' || promotion.applyMode === 'proposal-only') {
        const candidateFollowUp = createTranslatedResearchPromotion(promotion, appliedAt);
        const translationTrace = createResearchTranslationTrace(candidateFollowUp, promotion, appliedAt);
        const prepared = typeof preparePromotion === 'function'
          ? preparePromotion(candidateFollowUp, translationTrace)
          : { queued: true, promotion: candidateFollowUp };
        if (!prepared.queued) {
          const record = {
            ...baseRecord,
            status: 'blocked',
            details: `Research translation follow-up did not meet evolution pressure threshold (${prepared.reason || 'not queued'}).`,
          };
          store.appendAppliedMutation(record);
          return record;
        }
        const followUp = prepared.promotion;
        store.appendPromotion(followUp);
        store.appendTrace(translationTrace);
        if (typeof notifyQueuedPromotion === 'function') {
          void notifyQueuedPromotion(followUp, {
            sessionKey: typeof readNotificationSessionKey === 'function'
              ? readNotificationSessionKey(promotion.id)
              : null,
            metadata: {
              sourceProposalId: promotion.id,
            },
          });
        }
        const record = {
          ...baseRecord,
          status: 'translated',
          details: `Queued translated follow-up proposal ${followUp.id} for ${followUp.mutationTarget}.`,
          translatedProposalId: followUp.id,
        };
        store.appendAppliedMutation(record);
        return record;
      }

      if (promotion.applyMode === 'config-patch') {
        const runtimeConfig = store.readRuntimeConfig();
        const toolName = promotion?.evidence?.metadata?.toolName || 'unknown-tool';
        const error = String(promotion?.evidence?.metadata?.error || promotion?.evidence?.metadata?.status || 'unspecified failure');
        runtimeConfig.toolPolicies[toolName] = {
          lastUpdatedAt: appliedAt,
          sourceProposalId: promotion.id,
          recommendedHandling: classifyRuntimeHandling(error),
          reason: promotion.summary,
        };
        runtimeConfig.appliedProposals[promotion.id] = {
          appliedAt,
          target: promotion.mutationTarget,
        };
        store.writeRuntimeConfig(runtimeConfig);
        const record = {
          ...baseRecord,
          status: 'applied',
          details: `Updated runtime-config policy for ${toolName}.`,
        };
        store.appendAppliedMutation(record);
        return record;
      }

      if (promotion.applyMode === 'doc-patch' || promotion.applyMode === 'memory-update') {
        const targetPath = resolveMutationTargetPath(mutationRoot, promotion.mutationTarget);
        ensureParentDir(targetPath);
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(targetPath, defaultDocumentBody(promotion.mutationTarget));
        }
        fs.appendFileSync(targetPath, renderMutationEntry(promotion, appliedAt));
        const record = {
          ...baseRecord,
          status: 'applied',
          details: `Appended mutation guidance to ${promotion.mutationTarget}.`,
        };
        store.appendAppliedMutation(record);
        return record;
      }

      store.appendImplementationTask({
        proposalId: promotion.id,
        createdAt: appliedAt,
        summary: promotion.summary,
        mutationTarget: promotion.mutationTarget,
        evidence: promotion.evidence,
      });
      const record = {
        ...baseRecord,
        status: 'applied',
        details: 'Queued implementation task from approved proposal.',
      };
      store.appendAppliedMutation(record);
      return record;
    },
  };
}

function createResearchTranslationTrace(followUp, sourcePromotion, timestamp) {
  return {
    id: `${followUp.id}-trace`,
    timestamp,
    signalType: 'research',
    source: 'revenants',
    target: followUp.mutationTarget,
    action: 'research_translation',
    result: 'success',
    impactScore: followUp.impactScore,
    metadata: {
      sourceProposalId: sourcePromotion.id,
      suggestedMutationTarget: sourcePromotion?.researchAssessment?.suggestedMutationTarget || null,
    },
  };
}

function resolveMutationTargetPath(rootDir, mutationTarget) {
  return path.join(rootDir, mutationTarget);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultDocumentBody(mutationTarget) {
  if (mutationTarget === 'MEMORY.md') return '# Memory\n';
  if (mutationTarget === 'TOOLS.md') return '# Tools\n';
  if (mutationTarget === 'SOUL.md') return '# Soul\n';
  return '# Agent Notes\n';
}

function renderMutationEntry(promotion, appliedAt) {
  const lines = [
    '',
    `## Mutation ${promotion.id}`,
    '',
    `- Applied: ${appliedAt}`,
    `- Intent: ${promotion.intent}`,
    `- Type: ${promotion.proposalType}`,
    `- Reason: ${promotion.summary}`,
  ];
  if (promotion.mutationPlan?.summary) lines.push(`- Apply path: ${promotion.mutationPlan.summary}`);
  return `${lines.join('\n')}\n`;
}

function classifyRuntimeHandling(errorText, opts = {}) {
  const text = String(errorText || '').toLowerCase();
  const toolName = String(opts.toolName || '').toLowerCase();
  if (/timeout/.test(text)) return 'increase-timeout-and-retry-carefully';
  if (/^(web_fetch|web_search)$/.test(toolName) && /blocked|denied|forbidden|unauthor|private/.test(text)) {
    return 'document-tool-constraint-and-escalate';
  }
  if (/blocked|denied|forbidden|unauthor|private/.test(text)) return 'avoid-repeat-and-escalate';
  return 'monitor-and-tune';
}

function createTranslatedResearchPromotion(promotion, appliedAt) {
  const mutationTarget = promotion?.researchAssessment?.suggestedMutationTarget || 'implementation-task';
  const route = routeForMutationTarget(mutationTarget);
  const paperTitle = promotion?.researchAssessment?.sourcePaper?.title || 'research insight';
  const frameworkSummary = Array.isArray(promotion?.researchAssessment?.frameworks)
    && promotion.researchAssessment.frameworks.length > 0
    ? ` (${promotion.researchAssessment.frameworks.join('/')})`
    : '';
  return {
    id: `${promotion.id}-followup`,
    timestamp: appliedAt,
    traceId: promotion.traceId,
    signalType: 'research',
    source: 'revenants',
    target: 'libravdb-review-queue',
    intent: 'translate-research-insight',
    impactScore: promotion.impactScore,
    summary: `Translated research insight${frameworkSummary} from ${paperTitle} into a concrete ${route.type} proposal`,
    proposalType: route.type,
    mutationTarget: route.target,
    applyMode: route.applyMode,
    validationRequired: route.validationRequired,
    autoApplyEligible: false,
    mutationPlan: {
      rationale: 'Research insight approved first; this follow-up isolates the concrete local mutation for separate review.',
      summary: route.summary,
    },
    evidence: {
      action: 'research_translation',
      result: 'success',
      metadata: {
        sourceProposalId: promotion.id,
        sourcePaperTitle: paperTitle,
        sourceFrameworks: promotion?.researchAssessment?.frameworks || [],
        landingZones: promotion?.researchAssessment?.landingZones || [],
      },
    },
    researchAssessment: promotion?.researchAssessment
      ? {
          ...promotion.researchAssessment,
        }
      : undefined,
    parentProposalId: promotion.id,
  };
}

function routeForMutationTarget(target) {
  if (target === 'AGENTS.md') {
    return {
      type: 'policy',
      target,
      applyMode: 'doc-patch',
      validationRequired: ['human-review'],
      summary: 'Patch AGENTS.md with the approved research-derived policy or reasoning guidance.',
    };
  }
  if (target === 'TOOLS.md') {
    return {
      type: 'tooling',
      target,
      applyMode: 'doc-patch',
      validationRequired: ['human-review'],
      summary: 'Patch TOOLS.md with the approved research-derived tool workflow guidance.',
    };
  }
  if (target === 'SOUL.md') {
    return {
      type: 'personality',
      target,
      applyMode: 'doc-patch',
      validationRequired: ['human-review'],
      summary: 'Patch SOUL.md with the approved research-derived persona adjustment.',
    };
  }
  if (target === 'MEMORY.md') {
    return {
      type: 'memory',
      target,
      applyMode: 'memory-update',
      validationRequired: ['human-review'],
      summary: 'Update MEMORY.md with the approved research-derived durable context.',
    };
  }
  if (target === 'runtime-config') {
    return {
      type: 'runtime',
      target,
      applyMode: 'config-patch',
      validationRequired: ['schema', 'rollback', 'human-review'],
      summary: 'Prepare a validated runtime/config patch derived from the approved research insight.',
    };
  }
  return {
    type: 'implementation',
    target: 'implementation-task',
    applyMode: 'task',
    validationRequired: ['human-review'],
    summary: 'Convert the approved research insight into an implementation task for separate execution.',
  };
}

module.exports = {
  createPromotionApplier,
  classifyRuntimeHandling,
};
