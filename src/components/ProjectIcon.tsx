import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  Box,
  Braces,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  CheckCircle2,
  Circle,
  Clock3,
  Cloud,
  Coffee,
  Code2,
  Cpu,
  Database,
  File,
  FilePenLine,
  FileText,
  Folder,
  Gamepad2,
  Globe2,
  Hammer,
  Heart,
  Home,
  Link2,
  ListChecks,
  LockKeyhole,
  Monitor,
  Music,
  Palette,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Target,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ProjectColorName, ProjectIconName } from "../../desktop/types";

export const PROJECT_COLOR_OPTIONS: ReadonlyArray<{ name: ProjectColorName; label: string }> = [
  { name: "default", label: "Default" },
  { name: "red", label: "Red" },
  { name: "orange", label: "Orange" },
  { name: "yellow", label: "Yellow" },
  { name: "green", label: "Green" },
  { name: "blue", label: "Blue" },
  { name: "purple", label: "Purple" },
  { name: "pink", label: "Pink" },
];

export const PROJECT_ICON_OPTIONS: ReadonlyArray<{ name: ProjectIconName; label: string }> = [
  { name: "folder", label: "Folder" },
  { name: "circle", label: "Circle" },
  { name: "briefcase", label: "Briefcase" },
  { name: "box", label: "Package" },
  { name: "code", label: "Code" },
  { name: "file", label: "File" },
  { name: "file-text", label: "Document" },
  { name: "terminal", label: "Terminal" },
  { name: "pen", label: "Writing" },
  { name: "braces", label: "Braces" },
  { name: "bug", label: "Bug" },
  { name: "sparkles", label: "Sparkles" },
  { name: "rocket", label: "Launch" },
  { name: "target", label: "Target" },
  { name: "star", label: "Star" },
  { name: "heart", label: "Personal" },
  { name: "home", label: "Home" },
  { name: "globe", label: "Web" },
  { name: "cloud", label: "Cloud" },
  { name: "database", label: "Database" },
  { name: "cpu", label: "Compute" },
  { name: "monitor", label: "Desktop" },
  { name: "calendar", label: "Calendar" },
  { name: "clock", label: "Time" },
  { name: "check", label: "Complete" },
  { name: "list", label: "Tasks" },
  { name: "bookmark", label: "Bookmark" },
  { name: "tag", label: "Tag" },
  { name: "link", label: "Link" },
  { name: "lock", label: "Private" },
  { name: "shield", label: "Security" },
  { name: "wrench", label: "Tools" },
  { name: "hammer", label: "Build" },
  { name: "palette", label: "Design" },
  { name: "camera", label: "Media" },
  { name: "music", label: "Audio" },
  { name: "gamepad", label: "Play" },
  { name: "coffee", label: "Break" },
];

const icons: Record<ProjectIconName, LucideIcon> = {
  folder: Folder,
  circle: Circle,
  briefcase: Briefcase,
  box: Box,
  code: Code2,
  file: File,
  "file-text": FileText,
  terminal: TerminalSquare,
  pen: FilePenLine,
  braces: Braces,
  bug: Bug,
  sparkles: Sparkles,
  rocket: Rocket,
  target: Target,
  star: Star,
  heart: Heart,
  home: Home,
  globe: Globe2,
  cloud: Cloud,
  database: Database,
  cpu: Cpu,
  monitor: Monitor,
  calendar: Calendar,
  clock: Clock3,
  check: CheckCircle2,
  list: ListChecks,
  bookmark: Bookmark,
  tag: Tag,
  link: Link2,
  lock: LockKeyhole,
  shield: ShieldCheck,
  wrench: Wrench,
  hammer: Hammer,
  palette: Palette,
  camera: Camera,
  music: Music,
  gamepad: Gamepad2,
  coffee: Coffee,
};

export function ProjectIcon({ icon, color = "default", size = 15 }: { icon: ProjectIconName; color?: ProjectColorName; size?: number }) {
  const Icon = icons[icon] ?? Folder;
  return <span className={`project-icon project-color-${color}`}><Icon size={size} aria-hidden="true" /></span>;
}

interface ProjectAppearancePickerProps {
  icon: ProjectIconName;
  color: ProjectColorName;
  onIconChange: (icon: ProjectIconName) => void;
  onColorChange: (color: ProjectColorName) => void;
}

export function ProjectAppearancePicker({ icon, color, onIconChange, onColorChange }: ProjectAppearancePickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return;
    }
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popoverWidth = 302;
      const popoverHeight = 282;
      const edge = 8;
      const left = Math.min(Math.max(edge, rect.left), Math.max(edge, window.innerWidth - popoverWidth - edge));
      const below = rect.bottom + 7;
      const top = below + popoverHeight <= window.innerHeight - edge
        ? below
        : Math.max(edge, rect.top - popoverHeight - 7);
      setPopoverPosition({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const popover = open && popoverPosition ? <div
    ref={popoverRef}
    className="project-appearance-popover"
    role="dialog"
    aria-label="Project icon and color"
    style={{ top: popoverPosition.top, left: popoverPosition.left }}
  >
    <div className="project-color-grid" role="radiogroup" aria-label="Project color">
      {PROJECT_COLOR_OPTIONS.map((option) => <button
        key={option.name}
        type="button"
        role="radio"
        aria-checked={color === option.name}
        aria-label={option.label}
        title={option.label}
        className={`project-color-swatch project-color-${option.name} ${color === option.name ? "selected" : ""}`}
        onClick={() => onColorChange(option.name)}
      />)}
    </div>
    <div className="project-icon-grid" role="radiogroup" aria-label="Project icon">
      {PROJECT_ICON_OPTIONS.map((option) => <button
        key={option.name}
        type="button"
        role="radio"
        aria-checked={icon === option.name}
        aria-label={option.label}
        title={option.label}
        className={icon === option.name ? "selected" : ""}
        onClick={() => onIconChange(option.name)}
      >
        <ProjectIcon icon={option.name} color={color} size={15} />
      </button>)}
    </div>
    <button type="button" className="project-appearance-done" onClick={() => setOpen(false)}>Done</button>
  </div> : null;

  return <div className="project-appearance-picker">
    <button
      type="button"
      ref={triggerRef}
      className={`project-appearance-trigger project-color-${color}`}
      onClick={() => setOpen((value) => !value)}
      aria-label="Choose project icon and color"
      aria-expanded={open}
      title="Choose project icon and color"
    >
      <ProjectIcon icon={icon} color={color} size={15} />
    </button>
    {popover && createPortal(popover, document.body)}
  </div>;
}
