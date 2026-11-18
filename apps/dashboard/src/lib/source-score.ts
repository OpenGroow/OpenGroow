// Scores are 0..1. `replicationScore` only exists once the daily engagement
// job has run; before that a scored Source only has its three rubric scores,
// so their mean stands in. Shown on a 0..100 scale.
export function sourceScore(scoring: Record<string, number> | undefined): number | undefined {
  if (scoring === undefined) return undefined;
  const { replicationScore, productFit, replicability, creativeStrength } = scoring;
  const value =
    replicationScore ??
    (productFit !== undefined && replicability !== undefined && creativeStrength !== undefined
      ? (productFit + replicability + creativeStrength) / 3
      : undefined);
  return value === undefined ? undefined : Math.round(value * 100);
}
