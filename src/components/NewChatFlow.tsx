import logoUrl from "../assets/maximoai-logo.svg";
import { getNewChatFlow, NEW_CHAT_FLOWS, type NewChatFlowSelection } from "../newChatFlows";

type NewChatFlowProps = {
  projectName: string;
  selection?: NewChatFlowSelection;
  onSelect: (selection: NewChatFlowSelection) => void;
};

function FlowIcon({ flow, size = 18 }: { flow: ReturnType<typeof getNewChatFlow>; size?: number }) {
  const Icon = flow.icon;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export default function NewChatFlow({ projectName, selection, onSelect }: NewChatFlowProps) {
  const selectedFlow = selection ? getNewChatFlow(selection.flow) : undefined;

  return (
    <div className={`new-chat-flow ${selectedFlow ? "has-selection" : ""}`}>
      <div className="new-chat-flow-logo" aria-hidden="true">
        <img src={logoUrl} alt="" />
      </div>
      <h3>
        What should we build in <span>{projectName}</span>?
      </h3>

      {selectedFlow ? (
        <div className={`new-chat-flow-suggestions tone-${selectedFlow.tone}`} role="list" aria-label={`${selectedFlow.prompt} prompts`}>
          {selectedFlow.suggestions.map((prompt) => (
            <button
              type="button"
              className="new-chat-flow-suggestion"
              key={prompt}
              onClick={() => onSelect({ flow: selectedFlow.id, prompt })}
            >
              <span className="new-chat-flow-suggestion-icon"><FlowIcon flow={selectedFlow} size={17} /></span>
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="new-chat-flow-grid" role="list" aria-label="Start a new chat">
          {NEW_CHAT_FLOWS.map((flow) => (
            <button
              type="button"
              className={`new-chat-flow-card tone-${flow.tone}`}
              key={flow.id}
              onClick={() => onSelect({ flow: flow.id, prompt: flow.prompt })}
            >
              <span className="new-chat-flow-card-icon"><FlowIcon flow={flow} /></span>
              <strong>{flow.label.split("\n").map((line, index) => <span key={`${flow.id}-${index}`}>{line}</span>)}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
