import type { ProjectColorName, ProjectIconName } from "../../desktop/types";
import ProjectEditorModal, { type ProjectEditorValues } from "./ProjectEditorModal";

interface CreateProjectModalProps {
  onClose: () => void;
  onChooseSources: () => Promise<string[]>;
  onCreate: (name: string, sourcePaths: string[], spaceId: string | null, icon: ProjectIconName, color: ProjectColorName) => Promise<void>;
}

export default function CreateProjectModal({ onClose, onChooseSources, onCreate }: CreateProjectModalProps) {
  const save = async ({ name, sourcePaths, icon, color }: ProjectEditorValues) => {
    await onCreate(name, sourcePaths, null, icon, color);
  };
  return <ProjectEditorModal mode="create" onClose={onClose} onChooseSources={onChooseSources} onSave={save} />;
}
