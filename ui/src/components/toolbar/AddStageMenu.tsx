import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  STAGE_COLORS,
  STAGE_LABELS,
  type StageType,
} from "@/types/Pipeline";

interface AddStageMenuProps {
  onAdd: (stageType: StageType) => void;
}

const ALL_STAGES: StageType[] = [
  "LOAD",
  "FILTER",
  "JOIN",
  "UNION",
  "GROUP",
  "SORT",
  "SELECT",
  "CUSTOM",
];

export function AddStageMenu({ onAdd }: AddStageMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add stage
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Transformation type</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ALL_STAGES.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onAdd(s)}>
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: STAGE_COLORS[s] }}
            />
            <span className="text-sm">{STAGE_LABELS[s]}</span>
            <span className="ml-auto text-[10px] text-gray-400">{s}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
