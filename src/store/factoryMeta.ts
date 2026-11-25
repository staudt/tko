// Fills factory-backed sounds with their manifest metadata (name, slices, root, hit names) once the
// factory sounds are decoded. Not an undoable edit.
import { apply } from './project';
import { factorySlots } from './samples';
import { FACTORY_PREFIX } from './defaults';

export async function applyFactoryMeta(): Promise<void> {
  const slots = await factorySlots();
  apply(
    (p) => {
      let changed = false;
      const sounds = p.sounds.map((s) => {
        if (!s.sampleId?.startsWith(FACTORY_PREFIX)) return s;
        const f = slots.find((x) => `${FACTORY_PREFIX}${x.slot}` === s.sampleId);
        if (!f || (s.slices.length > 0 && s.hitNames)) return s;
        changed = true;
        return { ...s, name: f.name, kind: f.kind, root: f.root, slices: f.kind === 'drum' ? f.slices : [], hitNames: f.hitNames };
      });
      return changed ? { ...p, sounds } : p;
    },
    { undoable: false },
  );
}
