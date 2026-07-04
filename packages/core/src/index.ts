export {
  parseGraph,
  GraphSchemaError,
  type ParsedGraph,
  type GraphNode,
  type GraphEdge,
  type Tier,
} from "./graphSchema.js";
export {
  DEFAULT_CONFIG,
  resolveConfig,
  budgetForTier,
  type TiaConfig,
  type TraversalConfig,
  type FallbackConfig,
} from "./config.js";
export { expandFiles, type ExpansionResult, type FileHit } from "./expand.js";
export { auditCoverage, type AuditOptions, type AuditResult, type CoveredFile } from "./audit.js";
export { parseDirectives, applyDirectives, type DirectiveEdge } from "./directives.js";
export { checkFallback, globToRegExp, type FallbackFacts, type FallbackDecision } from "./fallback.js";
export {
  explainSelection,
  formatExplanation,
  EXPLAIN_VERSION,
  type Explanation,
  type ExplainRow,
  type ExplainInput,
} from "./explain.js";
