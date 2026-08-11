import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
};

export default function CustomSelect<T extends string>({ value, options, onChange, icon, disabled = false, className = "", placement = "bottom", ariaLabel, searchable = false, searchPlaceholder = "Search…" }: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  placement?: "top" | "bottom";
  ariaLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!searchable || !needle) return options;
    return options.filter((option) => `${option.label} ${option.value} ${option.description ?? ""}`.toLowerCase().includes(needle));
  }, [options, query, searchable]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    setActiveIndex(Math.max(0, visibleOptions.findIndex((option) => option.value === value)));
  }, [value, visibleOptions]);

  const move = (amount: number) => {
    if (visibleOptions.length === 0) return;
    setActiveIndex((index) => (index + amount + visibleOptions.length) % visibleOptions.length);
  };
  const choose = (option?: SelectOption<T>) => {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    setQuery("");
  };
  const toggle = () => {
    setOpen((visible) => {
      if (!visible) setQuery("");
      return !visible;
    });
  };

  return (
    <div className={`custom-select ${placement} ${open ? "open" : ""} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="custom-select-trigger"
        ref={triggerRef}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setQuery("");
              setOpen(true);
            }
            move(event.key === "ArrowDown" ? 1 : -1);
          }
          if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
          if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            choose(visibleOptions[activeIndex]);
          }
        }}
      >
        {(selected?.icon ?? icon) ? <span className="select-option-icon">{selected?.icon ?? icon}</span> : null}
        <span className="select-option-label">{selected?.label ?? value}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="custom-select-menu glass-panel">
          {searchable && (
            <div className="custom-select-search">
              <Search size={13} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    move(event.key === "ArrowDown" ? 1 : -1);
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    choose(visibleOptions[activeIndex]);
                  }
                  if (event.key === "Escape") {
                    setOpen(false);
                    setQuery("");
                    triggerRef.current?.focus();
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label={`Search ${ariaLabel.toLowerCase()}`}
              />
            </div>
          )}
          <div className="custom-select-options" role="listbox" aria-label={ariaLabel}>
            {visibleOptions.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option === selected}
                className={`${index === activeIndex ? "active " : ""}${option.icon ? "has-icon" : ""}`}
                key={`${option.value || "default"}-${option.label}-${index}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                {option.icon && <span className="select-option-icon">{option.icon}</span>}
                <span className="select-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                <span className="select-check">{option === selected && <Check size={13} />}</span>
              </button>
            ))}
            {visibleOptions.length === 0 && <div className="custom-select-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
