import { Bug, GitCompareArrows, Hammer, Telescope, type LucideIcon } from "lucide-react";

export type NewChatFlowId = "explore" | "build" | "review" | "fix";

export type NewChatFlowSelection = {
  flow: NewChatFlowId;
  prompt: string;
};

export type NewChatFlowDefinition = {
  id: NewChatFlowId;
  label: string;
  prompt: string;
  icon: LucideIcon;
  tone: "blue" | "purple" | "green" | "orange";
  suggestions: readonly string[];
};

export const NEW_CHAT_FLOWS: readonly NewChatFlowDefinition[] = [
  {
    id: "explore",
    label: "Explore and\nunderstand code",
    prompt: "Explore",
    icon: Telescope,
    tone: "blue",
    suggestions: [
      "Explore and learn how a feature works",
      "Explore implementation options for a feature",
      "Explore and compare architectural approaches",
      "Explore and document an API",
    ],
  },
  {
    id: "build",
    label: "Build a new feature,\napp, or tool",
    prompt: "Build",
    icon: Hammer,
    tone: "purple",
    suggestions: [
      "Build a new feature in this project",
      "Build a new app or tool from scratch",
      "Build an integration or workflow",
      "Build a prototype from this idea",
    ],
  },
  {
    id: "review",
    label: "Review code and\nsuggest changes",
    prompt: "Review",
    icon: GitCompareArrows,
    tone: "green",
    suggestions: [
      "Review this code for bugs and risks",
      "Review the architecture and suggest improvements",
      "Review these changes for quality and maintainability",
      "Review performance and reliability",
    ],
  },
  {
    id: "fix",
    label: "Fix issues and failures",
    prompt: "Fix",
    icon: Bug,
    tone: "orange",
    suggestions: [
      "Fix an issue in this project",
      "Investigate and fix a failing test",
      "Diagnose a bug or unexpected behavior",
      "Fix a performance or reliability problem",
    ],
  },
];

export function getNewChatFlow(id: NewChatFlowId): NewChatFlowDefinition {
  return NEW_CHAT_FLOWS.find((flow) => flow.id === id) ?? NEW_CHAT_FLOWS[0]!;
}
