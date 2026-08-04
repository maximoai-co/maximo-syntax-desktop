import {
  BarChart3,
  Briefcase,
  Camera,
  Cloud,
  Code2,
  FileText,
  FlaskConical,
  Gamepad2,
  Globe2,
  Hammer,
  Heart,
  Home,
  Lightbulb,
  Package,
  Palette,
  Rocket,
  Star,
  Target,
  TreePine,
  type LucideIcon,
} from "lucide-react";
import type { SpaceIconName } from "../../desktop/types";

export const SPACE_ICON_OPTIONS: ReadonlyArray<{ name: SpaceIconName; label: string }> = [
  { name: "briefcase", label: "Work" },
  { name: "home", label: "Home" },
  { name: "code", label: "Code" },
  { name: "rocket", label: "Launch" },
  { name: "lightbulb", label: "Ideas" },
  { name: "palette", label: "Design" },
  { name: "file", label: "Docs" },
  { name: "flask", label: "Experiments" },
  { name: "heart", label: "Personal" },
  { name: "star", label: "Important" },
  { name: "globe", label: "Web" },
  { name: "cloud", label: "Cloud" },
  { name: "hammer", label: "Build" },
  { name: "gamepad", label: "Play" },
  { name: "camera", label: "Media" },
  { name: "target", label: "Goals" },
  { name: "tree", label: "Growth" },
  { name: "chart", label: "Metrics" },
  { name: "toolbox", label: "Tools" },
];

const icons: Record<SpaceIconName, LucideIcon> = {
  briefcase: Briefcase,
  home: Home,
  code: Code2,
  rocket: Rocket,
  lightbulb: Lightbulb,
  palette: Palette,
  file: FileText,
  flask: FlaskConical,
  heart: Heart,
  star: Star,
  globe: Globe2,
  cloud: Cloud,
  hammer: Hammer,
  gamepad: Gamepad2,
  camera: Camera,
  target: Target,
  tree: TreePine,
  chart: BarChart3,
  toolbox: Package,
};

export function SpaceIcon({ icon, size = 14 }: { icon: SpaceIconName; size?: number }) {
  const Icon = icons[icon] ?? Briefcase;
  return <Icon size={size} aria-hidden="true" />;
}
