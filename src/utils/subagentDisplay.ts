const GENERIC_AGENT_TYPES = new Set([
  "general-purpose",
  "generalpurpose",
  "general_purpose",
  "agent",
  "sub-agent",
  "subagent",
  "worker",
]);

const FALLBACK_DESCRIPTIONS = new Set([
  "sub-agent task",
  "subagent task",
  "sub-agent",
  "subagent",
]);

export function isGenericSubagentType(agentType: string | undefined): boolean {
  if (!agentType) return true;
  return GENERIC_AGENT_TYPES.has(agentType.trim().toLowerCase());
}

export function subagentDisplayName(agent: {
  description?: string;
  agentType?: string;
}): string {
  const description = agent.description?.trim();
  const usableDescription = description && !FALLBACK_DESCRIPTIONS.has(description.toLowerCase())
    ? description
    : undefined;
  const agentType = agent.agentType?.trim();
  const usableType = agentType && !isGenericSubagentType(agentType) ? agentType : undefined;
  return usableDescription ?? usableType ?? "Sub-agent";
}

export function formatSubagentTitle(agent: {
  description?: string;
  agentType?: string;
}): string {
  return `subagent: ${subagentDisplayName(agent)}`;
}
