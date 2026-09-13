'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Entity, type Id } from '@/lib/entity';

type EntityInputProps = {
  value: Id | null;
  onChange: (id: Id) => void;
  entities: Array<Entity>;
  placeholder?: string;
  /** Optional callback to render a label for each entity. Defaults to the short id. */
  getLabel?: (entity: Entity) => string;
};

/** A dropdown which lets a user pick a single entity from a list. Used to select which geometry
 *  a constraint endpoint / filter is locked to. */
export default function EntityInput({
  value,
  onChange,
  entities,
  placeholder = 'None',
  getLabel = (entity) => entity.id.slice(0, 8),
}: EntityInputProps) {
  return (
    <Select value={value ?? undefined} onValueChange={(next) => onChange(next)}>
      <SelectTrigger className="w-full" fieldSize="sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {entities.length === 0 ? (
          <SelectItem value="__none__" disabled>
            No entities
          </SelectItem>
        ) : (
          entities.map((entity) => (
            <SelectItem key={entity.id} value={entity.id}>
              {getLabel(entity)}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
