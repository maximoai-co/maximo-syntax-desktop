import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";

export interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface QuestionModalProps {
  questions: Question[];
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

function isOptionSelected(current: string | undefined, optionLabel: string, multi: boolean): boolean {
  if (!current) return false;
  if (!multi) return current === optionLabel;
  return current.split("||").includes(optionLabel);
}

function toggleSelection(current: string | undefined, optionLabel: string, multi: boolean): string {
  if (!multi) return optionLabel;
  const list = current ? current.split("||").filter(Boolean) : [];
  const idx = list.indexOf(optionLabel);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(optionLabel);
  return list.join("||");
}

export default function QuestionModal({ questions, onSubmit, onSkip }: QuestionModalProps) {
  const initial = useMemo(() => {
    const seed: Record<string, string> = {};
    for (const q of questions) seed[q.question] = "";
    return seed;
  }, [questions]);
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAnswers(initial);
    setCustomAnswers({});
    setActiveIndex(0);
  }, [initial]);

  if (questions.length === 0) return null;
  const active = questions[Math.min(activeIndex, questions.length - 1)];
  const multi = Boolean(active.multiSelect);
  const selected = answers[active.question] ?? "";
  const custom = customAnswers[active.question] ?? "";
  const listedOptions = active.options.filter((option) => option.label.trim().toLowerCase() !== "other");
  const activeAnswer = custom.trim() || selected;
  const allAnswered = questions.every((q) => {
    const hasCustomAnswer = Boolean((customAnswers[q.question] ?? "").trim());
    const hasSelectedAnswer = (answers[q.question] ?? "").split("||").some(Boolean);
    return hasCustomAnswer || hasSelectedAnswer;
  });

  const choose = (label: string) => {
    setAnswers((prev) => ({ ...prev, [active.question]: toggleSelection(prev[active.question], label, multi) }));
  };

  const submit = () => {
    const cleaned: Record<string, string> = {};
    for (const q of questions) {
      const custom = customAnswers[q.question]?.trim();
      const value = answers[q.question] ?? "";
      if (custom) {
        const selectedOptions = value.split("||").filter(Boolean);
        cleaned[q.question] = q.multiSelect && selectedOptions.length
          ? [...selectedOptions, custom].join(", ")
          : custom;
      } else if (value) {
        if (q.multiSelect) {
          const list = value.split("||").filter(Boolean);
          cleaned[q.question] = list.join(", ");
        } else {
          cleaned[q.question] = value;
        }
      }
    }
    onSubmit(cleaned);
  };

  return (
    <section className="question-panel" role="dialog" aria-labelledby="question-modal-title">
        <header className="modal-header">
          <div>
            <span className="eyebrow">MAXIMO ASKS</span>
            <h2 id="question-modal-title">Answer to continue</h2>
          </div>
          <button type="button" onClick={onSkip} aria-label="Close"><X size={17} /></button>
        </header>
        {questions.length > 1 && (
          <nav className="question-pagination">
            {questions.map((q, i) => {
              const answered = Boolean((customAnswers[q.question] ?? "").trim() || (answers[q.question] ?? "").split("||").some(Boolean));
              return (
                <button
                  key={`${i}-${q.question}`}
                  type="button"
                  className={`question-page-tab ${i === activeIndex ? "active" : ""} ${answered ? "answered" : ""}`}
                  onClick={() => setActiveIndex(i)}
                >
                  <span className="question-page-tab-index">{i + 1}</span>
                  <span>{q.header ?? q.question.slice(0, 32)}</span>
                  {answered && <Check size={11} />}
                </button>
              );
            })}
          </nav>
        )}
        <div className="question-body">
          <div className="question-prompt">
            {active.header && <span className="question-chip">{active.header}</span>}
            <h3>{active.question}</h3>
            <small>{multi ? "Select all that apply" : "Choose one"}</small>
          </div>
          <div className="question-options">
            {listedOptions.map((option) => {
              const selected = isOptionSelected(answers[active.question], option.label, multi);
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`question-option ${selected ? "selected" : ""}`}
                  onClick={() => choose(option.label)}
                  aria-pressed={selected}
                >
                  <span className="question-option-mark">{selected ? <Check size={13} /> : null}</span>
                  <span className="question-option-body">
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="question-other-zone">
            <button
              type="button"
              className={`question-option question-other-option ${custom.trim() ? "selected" : ""}`}
              onClick={() => customInputRef.current?.focus()}
              aria-pressed={Boolean(custom.trim())}
            >
              <span className="question-option-mark">{custom.trim() ? <Check size={13} /> : null}</span>
              <span className="question-option-body">
                <strong>Other</strong>
                <small>Type an answer not listed above</small>
              </span>
            </button>
            <label className={`question-custom-answer ${custom.trim() ? "selected" : ""}`}>
              <span>Your answer</span>
              <input
                ref={customInputRef}
                value={custom}
                onChange={(event) => setCustomAnswers((prev) => ({ ...prev, [active.question]: event.target.value }))}
                aria-label={`Other answer for ${active.question}`}
                placeholder="Type your own answer"
              />
            </label>
        </div>
        <footer className="modal-footer">
          {questions.length > 1 ? (
            <>
              <button type="button" className="secondary-button" onClick={() => setActiveIndex((i) => Math.max(0, i - 1))} disabled={activeIndex === 0}>Back</button>
              {activeIndex < questions.length - 1
                ? <button type="button" className="primary-button compact" onClick={() => setActiveIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={!activeAnswer.trim()}>Next</button>
                : <button type="button" className="primary-button compact" onClick={submit} disabled={!allAnswered}>Submit answers</button>}
            </>
          ) : (
            <button type="button" className="primary-button compact" onClick={submit} disabled={!activeAnswer.trim()}>Submit answer</button>
          )}
        </footer>
      </section>
  );
}
