import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Thread } from "../../desktop/types";

interface MessageTrailItem {
  id: string;
  ordinal: number;
  preview: string;
  responsePreview: string;
}

interface MessageTrailProps {
  thread?: Thread;
  onSelect: (messageId: string) => void;
}

const MIN_PANE_WIDTH = 920;
const TICK_SPACING = 10;

function previewText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 280).trimEnd()}…` : text;
}

function trailItemsFor(thread?: Thread): MessageTrailItem[] {
  const items: MessageTrailItem[] = [];
  let current = -1;
  for (const message of thread?.messages ?? []) {
    if (message.role === "user" && message.kind !== "follow-up") {
      items.push({
        id: message.id,
        ordinal: items.length + 1,
        preview: previewText(message.content),
        responsePreview: "",
      });
      current = items.length - 1;
      continue;
    }
    if (message.role === "assistant" && current >= 0) {
      const response = previewText(message.content);
      if (response) items[current]!.responsePreview = response;
    }
  }
  return items;
}

function MessageTrail({ thread, onSelect }: MessageTrailProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [hasGutter, setHasGutter] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tooltip, setTooltip] = useState<{ index: number; top: number } | null>(null);
  // Memoize trail items strictly by thread id + message count + last message id
  // to avoid recomputing on every parent render when thread object identity
  // changes but content hasn't. This keeps thread switching smooth.
  const items = useMemo(() => trailItemsFor(thread), [thread?.id, thread?.messages.length, thread?.messages.at(-1)?.id]);
  const visible = hasGutter && items.length > 1;

  useEffect(() => {
    const root = rootRef.current;
    const pane = root?.parentElement;
    if (!pane) return;
    const measure = () => setHasGutter(pane.clientWidth >= MIN_PANE_WIDTH);
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(pane);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const scroll = root?.parentElement?.querySelector<HTMLElement>(".conversation-scroll");
    if (!scroll || items.length === 0) {
      setActiveIndex(0);
      return;
    }

    let frame: number | null = null;
    const update = () => {
      frame = null;
      const scrollRect = scroll.getBoundingClientRect();
      const threshold = Math.min(180, scroll.clientHeight * 0.24);
      let next = 0;
      items.forEach((item, index) => {
        const element = document.getElementById(`message-${item.id}`);
        if (element && scroll.contains(element) && element.getBoundingClientRect().top - scrollRect.top <= threshold) next = index;
      });
      if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80) next = items.length - 1;
      setActiveIndex((current) => current === next ? current : next);
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    const onScroll = () => {
      setTooltip(null);
      schedule();
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    schedule();
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  const showTooltip = (index: number, element: HTMLElement) => {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setTooltip({ index, top: rect.top - rootRect.top + rect.height / 2 });
  };

  return (
    <nav
      ref={rootRef}
      className={`message-trail ${visible ? "visible" : ""}`}
      aria-label="Message navigation"
      aria-hidden={!visible}
      onMouseLeave={() => setTooltip(null)}
    >
      <div className="message-trail-viewport">
        <div className="message-trail-track" style={{ height: `${Math.max(48, 24 + (items.length - 1) * TICK_SPACING)}px` }}>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`message-trail-tick ${index === activeIndex ? "active" : ""}`}
              style={{ top: `${12 + index * TICK_SPACING}px` }}
              tabIndex={visible ? 0 : -1}
              aria-label={`Message ${item.ordinal}: ${item.preview.slice(0, 60)}`}
              aria-current={index === activeIndex ? "location" : undefined}
              onMouseEnter={(event) => showTooltip(index, event.currentTarget)}
              onFocus={(event) => showTooltip(index, event.currentTarget)}
              onBlur={() => setTooltip(null)}
              onClick={() => onSelect(item.id)}
            />
          ))}
        </div>
      </div>
      {tooltip && items[tooltip.index] && (
        <div className="message-trail-tooltip" style={{ top: tooltip.top }} role="tooltip">
          <strong>{items[tooltip.index]!.preview || "Message"}</strong>
          {items[tooltip.index]!.responsePreview && <span>{items[tooltip.index]!.responsePreview}</span>}
        </div>
      )}
    </nav>
  );
}

export default memo(MessageTrail);
